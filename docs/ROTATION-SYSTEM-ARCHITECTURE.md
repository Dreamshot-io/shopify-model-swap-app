# Rotation System Architecture & Key Concepts

## Overview
The rotation system manages A/B testing by swapping product images between BASE (original) and TEST (variant) cases. This document describes the state-machine architecture implemented to ensure reliable, data-safe image rotations.

## Table of Contents
1. [Core Problems Solved](#core-problems-solved)
2. [Key Concepts](#key-concepts)
3. [Architecture Overview](#architecture-overview)
4. [Implementation Details](#implementation-details)
5. [Critical Fixes Applied](#critical-fixes-applied)
6. [Recovery Mechanisms](#recovery-mechanisms)

---

## Core Problems Solved

### 1. Duplicate Image Uploads
**Problem**: When the same image was used in both gallery and variant hero, it was uploaded twice to Shopify.

**Solution**: Unified Media Registry that deduplicates images by normalized URL before upload.

### 2. Lost Variant Hero Images
**Problem**: Variant hero images weren't backed up to R2, causing restoration failures when rotating back to BASE.

**Solution**: Added R2 backup process in `captureVariantHeroImages()` matching the gallery backup pattern.

### 3. Complete Data Loss on BASE Rotation
**Problem**: `canSafelyDeleteMedia()` compared mediaIds instead of URLs, causing ALL images to be deleted.

**Solution**: Compare normalized URLs (stable) instead of mediaIds (change between rotations).

### 4. Stale ID References
**Problem**: Database stored old mediaIds that became invalid after deletions/recreations.

**Solution**: Query fresh state before rotation and update database with new IDs after rotation.

---

## Key Concepts

### State-Machine Approach
The rotation process follows a deterministic 4-step state machine:

```
CAPTURE STATE → BUILD TARGET → EXECUTE ROTATION → VERIFY & UPDATE
```

1. **CAPTURE STATE**: Query current Shopify product state (fresh IDs)
2. **BUILD TARGET**: Construct desired state with deduplication
3. **EXECUTE**: Delete/add/reorder media and update variants
4. **VERIFY**: Check results and update database with new IDs

### Image Identity Management

#### Three Types of URLs
1. **Shopify URL**: Original product image URL from Shopify CDN
2. **Permanent URL**: R2 backup URL for restoration (never changes)
3. **Normalized URL**: URL without query params, used for comparison

#### ImageData Structure
```typescript
interface ImageData {
  url: string;              // Original Shopify URL
  permanentUrl?: string;     // R2 backup URL (critical for restoration)
  mediaId?: string;          // Current Shopify MediaImage ID (changes!)
  position: number;          // Display order
  altText?: string;          // Image alt text
}
```

### URL vs ID Comparison
- **IDs are unstable**: Change when images are deleted/recreated
- **URLs are stable**: Especially permanentUrls from R2
- **Always compare by URL** when determining what to keep/delete

---

## Architecture Overview

### Component Hierarchy
```
SimpleRotationService (main orchestrator)
├── captureCurrentState()      - Snapshot current Shopify state
├── buildTargetState()         - Build desired end state
│   └── buildMediaRegistry()   - Deduplicate images
├── executeRotation()          - Perform changes
│   ├── deleteProductMedia()   - Remove unneeded images
│   ├── uploadMediaToProduct() - Add new images
│   ├── reorderProductMedia()  - Fix image order
│   └── attachMediaToVariant() - Set variant heroes
└── verifyRotation()           - Check success & update DB
```

### Data Flow
```
Database (JSON)
    ↓ (baseImages, testImages with permanentUrls)
Build Target State
    ↓ (unified media registry)
Compare with Current State
    ↓ (determine operations)
Execute Operations
    ↓ (delete, upload, attach)
Verify & Update Database
    ↓ (fresh mediaIds)
Success
```

---

## Implementation Details

### 1. State Capture (`captureCurrentState`)
```typescript
// Queries fresh state from Shopify
{
  galleryMedia: [
    { mediaId: "gid://...", url: "https://cdn.shopify...", position: 0 }
  ],
  variantAssignments: Map<variantId, { heroMediaId, heroUrl }>
}
```

### 2. Target State Building (`buildTargetState`)
```typescript
// Builds unified registry with deduplication
{
  targetGallery: ImageData[],        // Desired gallery state
  targetVariantHeros: Map<>,         // Desired variant heroes
  mediaRegistry: Map<normalizedUrl, {
    permanentUrl?: string,
    url: string,
    usage: ['gallery' | 'variant_hero'],
    variants?: string[]             // Which variants use this
  }>
}
```

### 3. Deletion Safety Check (`canSafelyDeleteMedia`)
```typescript
// CRITICAL: Must compare URLs, not IDs!
function canSafelyDeleteMedia(mediaId, currentState, targetState) {
  // Get URL from current state
  const currentUrl = normalizeUrl(currentMedia.url);

  // Check if URL exists in target state
  const inTarget = targetState.targetGallery.some(img =>
    normalizeUrl(img.permanentUrl || img.url) === currentUrl
  );

  return !inTarget; // Safe to delete if not in target
}
```

### 4. Media Operations Tracking
```typescript
const mediaOperations = {
  uploaded: Map<permanentUrl, newMediaId>,  // New uploads
  reused: Map<permanentUrl, existingId>,    // Kept existing
  deleted: Set<mediaId>                      // Removed
};
```

### 5. Database Update Pattern
```typescript
// After rotation, update with fresh IDs
await db.aBTest.update({
  where: { id: testId },
  data: {
    baseImages: JSON.parse(JSON.stringify(updatedImages)), // Deep clone
    testImages: JSON.parse(JSON.stringify(updatedImages)),
  }
});
```

---

## Critical Fixes Applied

### Fix 1: Variant Hero Backup (Lines 1210-1262)
**Before**: No R2 backup for variant heroes
```typescript
heroImages.set(variantId, {
  url: shopifyUrl,
  mediaId: mediaId,
  // NO permanentUrl!
});
```

**After**: Full backup to R2
```typescript
const permanentUrl = await storeImagePermanently(shopifyUrl, filename);
heroImages.set(variantId, {
  url: shopifyUrl,
  permanentUrl,  // Now backed up!
  mediaId,
});
```

### Fix 2: URL-Based Deletion Check (Lines 1472-1504)
**Before**: Compared unstable mediaIds
```typescript
const inTargetGallery = targetState.targetGallery.some(
  img => img.mediaId === mediaId  // WRONG!
);
```

**After**: Compare stable URLs
```typescript
const currentNormalizedUrl = this.normalizeUrl(currentMedia.url);
const inTargetGallery = targetState.targetGallery.some(img => {
  const targetUrl = this.normalizeUrl(img.permanentUrl || img.url);
  return targetUrl === currentNormalizedUrl;  // CORRECT!
});
```

### Fix 3: Correct GraphQL Mutation (Lines 1597-1637)
**Before**: Non-existent mutation
```typescript
productVariantUpdate(input: { id, mediaId })  // Doesn't exist!
```

**After**: Correct bulk update
```typescript
productVariantsBulkUpdate(
  productId: $productId,
  variants: [{ id: $variantId, mediaId: $mediaId }]
)
```

### Fix 4: Unified Media Registry (Lines 1402-1441)
**Implementation**: Deduplicates images across gallery and variants
```typescript
// Process all images through single registry
for (const img of targetGallery) {
  const key = normalizeUrl(img.permanentUrl || img.url);
  mediaRegistry.set(key, { ...img, usage: ['gallery'] });
}

for (const [variantId, heroImage] of targetVariantHeros) {
  const key = normalizeUrl(heroImage.permanentUrl || heroImage.url);
  if (mediaRegistry.has(key)) {
    // Reuse existing entry
    mediaRegistry.get(key).usage.push('variant_hero');
  } else {
    // Add new entry
    mediaRegistry.set(key, { ...heroImage, usage: ['variant_hero'] });
  }
}
```

---

## Recovery Mechanisms

### Base Image Recovery Service
Located at: `app/services/recover-base-images.server.ts`

**Purpose**: Restore base images that were accidentally deleted due to the mediaId comparison bug.

**Process**:
1. Query test's baseImages from database
2. Check for permanentUrls (R2 backups)
3. Upload from R2 to Shopify if missing
4. Update database with new mediaIds

### Recovery UI
Located at: `app/routes/app.recover-base-images.tsx`

**Access**: `/app/recover-base-images`

**Features**:
- Lists all tests that might need recovery
- One-click recovery for all affected tests
- Individual test recovery option
- Shows backup availability status

### Usage
```typescript
// Programmatic recovery
const result = await BaseImageRecoveryService.recoverBaseImages(admin, testId);

// Recovery via UI
Navigate to: /app/recover-base-images
Click: "Recover All Affected Tests"
```

---

## State Verification

### Post-Rotation Verification
After each rotation, the system:
1. Captures post-rotation state
2. Compares with expected target
3. Logs discrepancies
4. Updates database with fresh IDs

### Verification Metadata
```typescript
{
  preRotationState: {
    galleryCount: 5,
    variantHeroCount: 2,
  },
  postRotationState: {
    galleryCount: 5,
    variantHeroCount: 2,
  },
  operations: {
    uploaded: 3,
    reused: 2,
    deleted: 3,
  }
}
```

---

## Best Practices

### DO's
✅ Always backup images to R2 before rotation
✅ Compare URLs, not IDs for image identity
✅ Query fresh state before operations
✅ Update database with new IDs after rotation
✅ Log all operations for debugging
✅ Verify state after rotation

### DON'Ts
❌ Never compare mediaIds between rotations
❌ Don't assume IDs are stable
❌ Don't delete without checking all usages
❌ Never skip R2 backup for critical images
❌ Don't trust stale database IDs

---

## Testing Checklist

### Basic Rotation
- [ ] BASE → TEST rotation works
- [ ] TEST → BASE rotation works
- [ ] Images maintain correct order
- [ ] No duplicate uploads

### Variant Heroes
- [ ] Hero images set correctly
- [ ] Heroes removed when target is null
- [ ] Same image in gallery + variant uploaded once
- [ ] Heroes restore from R2 backup

### Edge Cases
- [ ] Empty galleries handled
- [ ] Products with >100 images
- [ ] Variants without heroes
- [ ] Concurrent rotations blocked
- [ ] Failed uploads rolled back

### Recovery
- [ ] Base images recoverable from R2
- [ ] Recovery UI shows correct tests
- [ ] Batch recovery works
- [ ] Individual recovery works

---

## Performance Considerations

### Optimization Opportunities
1. **Batch Operations**: Group GraphQL mutations
2. **Parallel Uploads**: Upload multiple images concurrently
3. **Cache Normalized URLs**: Avoid repeated URL parsing
4. **Lazy Verification**: Verify only on errors

### Current Bottlenecks
- Sequential image uploads (could parallelize)
- Individual variant updates (could batch)
- JSON.parse/stringify for deep cloning (use structured clone)

---

## Future Improvements

### Short Term
- [ ] Add retry logic for transient failures
- [ ] Implement proper TypeScript types (remove type assertions)
- [ ] Add comprehensive error recovery
- [ ] Create unit tests for critical functions

### Long Term
- [ ] Implement proper state machine library
- [ ] Add monitoring and alerting
- [ ] Create rollback mechanism
- [ ] Build admin UI for manual intervention

---

## Conclusion

The state-machine rotation system provides reliable, data-safe image management for A/B testing. Key innovations include:

1. **URL-based identity** instead of unstable IDs
2. **Unified media registry** for deduplication
3. **R2 backups** for all images including variant heroes
4. **State verification** after each rotation
5. **Recovery mechanisms** for data loss scenarios

This architecture ensures that base images are **never lost** and rotations are **predictable and verifiable**.

---

*Last Updated: November 2024*
*Version: 2.0 (State-Machine Architecture)*