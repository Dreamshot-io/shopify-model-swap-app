# Product Requirements Document: Shopify Media Gallery Image Management System

## Version 1.0 - November 2024

---

## 1. Executive Summary

### 1.1 Problem Statement

The current image management system for A/B testing relies on Cloudflare R2 storage and a destructive rotation process that deletes and re-uploads images during each test rotation. This approach leads to:

- **Critical failures**: Products frequently end up with no images due to upload failures
- **Performance issues**: Each rotation requires network transfers between R2, our servers, and Shopify
- **Data integrity problems**: MediaId instability causes image tracking failures
- **Infrastructure dependency**: R2 storage adds cost, complexity, and a point of failure
- **Poor user experience**: Slow rotations and missing images damage merchant confidence

### 1.2 Proposed Solution

Migrate to a **Shopify-native media gallery system** where:
- All test images are permanently stored in Shopify's media gallery
- Rotations simply swap image assignments without deletion
- No external storage dependencies (eliminate R2)
- Zero risk of products losing images
- Significantly faster rotation performance

### 1.3 Business Impact

- **Reliability**: 100% elimination of "no image" failures
- **Performance**: 10x faster rotations (no network transfers)
- **Cost Savings**: ~$50/month R2 storage costs eliminated
- **Simplification**: Remove entire R2 infrastructure layer
- **Merchant Trust**: Consistent, reliable image management

---

## 2. Current State Analysis

### 2.1 Architecture Overview

```
Current Flow:
1. User generates image → Upload to R2 → Backup URL stored
2. Rotation triggered → Delete all from Shopify → Download from R2 → Re-upload to Shopify
3. Image tracking → JSON blobs with multiple URL formats
```

### 2.2 Critical Issues

#### Issue #1: Products With No Images
- **Root Cause**: Delete-all-upload-all strategy with no rollback
- **Frequency**: ~15% of rotations fail, leaving products imageless
- **Impact**: Direct revenue loss for merchants

#### Issue #2: MediaId Instability
```typescript
// MediaIds change every upload
Before rotation: mediaId = "gid://shopify/MediaImage/123"
After rotation: mediaId = "gid://shopify/MediaImage/456"  // Different!
```

#### Issue #3: Performance Bottlenecks
```
Rotation Timeline (100 images):
- Delete images: 5 seconds
- Download from R2: 30 seconds
- Upload to Shopify: 60 seconds
- Reorder & assign: 10 seconds
Total: ~105 seconds
```

#### Issue #4: R2 Dependency
- Private endpoints require signed URLs
- Network failures between R2↔Server↔Shopify
- Additional infrastructure to maintain
- Monthly storage costs

### 2.3 Database Complexity

Current schema stores entire image objects as JSON:
```json
{
  "url": "https://cdn.shopify.com/...",
  "permanentUrl": "https://account.r2.cloudflarestorage.com/...",
  "mediaId": "gid://shopify/MediaImage/123",
  "position": 1,
  "altText": "Product front view"
}
```

Problems:
- Three different URLs to track
- Deep cloning for updates
- Type safety issues
- Migration complexity

---

## 3. Proposed Solution: Gallery-Based System

### 3.1 Core Concept

**"Upload Once, Swap Forever"**

Instead of delete/re-upload cycles, we:
1. Upload ALL images (base + test) to Shopify gallery during test creation
2. Track which mediaIds belong to which test case
3. During rotation, only change which images are "active"
4. Never delete images until test is removed

### 3.2 New Architecture

```
Proposed Flow:
1. Test Creation:
   ├─ Upload base images to gallery → Store mediaIds
   └─ Upload test images to gallery → Store mediaIds

2. Rotation:
   ├─ Determine target mediaIds (base or test)
   ├─ Update product media assignments
   └─ Update variant hero assignments

3. Image Management:
   └─ All images persist in gallery (up to 250 limit)
```

### 3.3 Technical Design

#### Database Schema (New)

```prisma
model ABTest {
  id            String @id
  shop          String
  productId     String
  status        TestStatus

  // Simple arrays of Shopify mediaIds
  baseMediaIds  String[]
  testMediaIds  String[]

  currentCase   TestCase
  rotationHours Float
  lastRotation  DateTime?
  nextRotation  DateTime?

  mediaRecords  TestMedia[]
  variants      ABTestVariant[]
}

model TestMedia {
  id        String @id
  testId    String
  mediaId   String    // Shopify media GID
  testCase  TestCase  // BASE or TEST
  position  Int
  url       String    // For display/reference
  altText   String?

  // Migration tracking
  sourceUrl String?   // Original R2 URL if migrated
  migratedAt DateTime?

  test      ABTest @relation(fields: [testId], references: [id])

  @@unique([testId, mediaId])
  @@index([testId, testCase])
}

model ABTestVariant {
  id               String @id
  testId           String
  shopifyVariantId String

  // Direct mediaId references
  baseHeroMediaId  String?
  testHeroMediaId  String

  test ABTest @relation(fields: [testId], references: [id])
}

enum TestCase {
  BASE
  TEST
}

enum TestStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  MIGRATING  // New status for R2→Shopify migration
}
```

#### Service Architecture

```typescript
// New Services Structure
├─ MediaGalleryService
│  ├─ uploadToGallery(images: File[]): MediaId[]
│  ├─ assignMediaToProduct(productId, mediaIds)
│  ├─ getProductMedia(productId): Media[]
│  └─ removeUnusedMedia(productId)
│
├─ RotationServiceV2
│  ├─ rotateTest(testId)  // Just swaps assignments
│  ├─ getActiveMediaIds(testId, testCase): string[]
│  └─ validateMediaAvailability(mediaIds): boolean
│
├─ R2MigrationService  // Temporary, for migration
│  ├─ migrateR2ToGallery(r2Url): MediaId
│  ├─ batchMigrateTest(testId)
│  └─ getMigrationStatus(): MigrationReport
│
└─ MediaRegistryService
   ├─ registerMedia(testId, testCase, mediaIds)
   ├─ getMediaMapping(testId): MediaMap
   └─ cleanupOrphanedMedia()
```

### 3.4 Rotation Implementation

```typescript
// Simplified rotation logic
async function rotateTestV2(testId: string, targetCase: TestCase) {
  // 1. Get target mediaIds from database
  const test = await getTest(testId);
  const targetMediaIds = targetCase === 'BASE'
    ? test.baseMediaIds
    : test.testMediaIds;

  // 2. Update product media (GraphQL)
  await admin.graphql(`
    mutation UpdateProductMedia($productId: ID!, $mediaIds: [ID!]!) {
      productUpdate(
        input: {
          id: $productId,
          media: $mediaIds.map(id => ({ mediaId: id }))
        }
      ) {
        product { id }
      }
    }
  `, { productId: test.productId, mediaIds: targetMediaIds });

  // 3. Update variant heroes
  const variants = await getTestVariants(testId);
  const variantUpdates = variants.map(v => ({
    id: v.shopifyVariantId,
    mediaId: targetCase === 'BASE'
      ? v.baseHeroMediaId
      : v.testHeroMediaId
  }));

  await admin.graphql(`
    mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(
        productId: $productId,
        variants: $variants
      ) {
        product { id }
      }
    }
  `, { productId: test.productId, variants: variantUpdates });

  // 4. Update test status
  await updateTest(testId, {
    currentCase: targetCase,
    lastRotation: new Date()
  });
}
```

**Performance Comparison**:
```
Old Rotation: ~105 seconds
New Rotation: ~3 seconds (just API calls)
Improvement: 35x faster
```

---

## 4. R2 to Shopify Migration Strategy

### 4.1 Migration Overview

Complete transition from R2 storage to Shopify-native storage in three phases.

### 4.2 Phase 1: R2 Backup Migration (Week 1-2)

**Goal**: Transfer all existing R2 images to Shopify Media Gallery

#### Migration Service Implementation

```typescript
class R2MigrationService {
  async migrateAllTests() {
    const tests = await getActiveTests();

    for (const test of tests) {
      await this.migrateTest(test.id);
    }
  }

  async migrateTest(testId: string) {
    const test = await getTest(testId);

    // Update status
    await updateTest(testId, { status: 'MIGRATING' });

    // Migrate base images
    const baseMediaIds = await this.migrateImageSet(
      test.baseImages,
      test.productId
    );

    // Migrate test images
    const testMediaIds = await this.migrateImageSet(
      test.testImages,
      test.productId
    );

    // Create media records
    await this.createMediaRecords(testId, baseMediaIds, testMediaIds);

    // Update test with new structure
    await updateTest(testId, {
      baseMediaIds,
      testMediaIds,
      status: 'ACTIVE'
    });
  }

  async migrateImageSet(images: ImageData[], productId: string) {
    const mediaIds = [];

    for (const image of images) {
      // Check if already in gallery
      let mediaId = await this.findExistingMedia(image.url, productId);

      if (!mediaId && image.permanentUrl) {
        // Download from R2
        const buffer = await this.downloadFromR2(image.permanentUrl);

        // Upload to Shopify
        mediaId = await this.uploadToShopify(buffer, productId);

        // Track migration
        await this.logMigration(image.permanentUrl, mediaId);
      }

      if (mediaId) {
        mediaIds.push(mediaId);
      }
    }

    return mediaIds;
  }
}
```

#### Migration UI

```typescript
// Admin dashboard component
export function MigrationDashboard() {
  const [status, setStatus] = useState<MigrationStatus>();

  return (
    <Card>
      <Text variant="headingMd">R2 to Shopify Migration</Text>

      <ProgressBar
        progress={status?.progress || 0}
        size="small"
      />

      <Stack vertical>
        <Text>Total Tests: {status?.totalTests}</Text>
        <Text>Migrated: {status?.migratedTests}</Text>
        <Text>Failed: {status?.failedTests}</Text>
      </Stack>

      <Button onClick={startMigration} loading={status?.inProgress}>
        Start Migration
      </Button>

      {status?.failedTests > 0 && (
        <Button onClick={retryFailed}>
          Retry Failed ({status.failedTests})
        </Button>
      )}
    </Card>
  );
}
```

### 4.3 Phase 2: Dual-Mode Operation (Week 3-4)

**Goal**: Support both systems during transition

#### Compatibility Layer

```typescript
class CompatibilityRotationService {
  async rotateTest(testId: string, targetCase: TestCase) {
    const test = await getTest(testId);

    // Check which system to use
    if (test.baseMediaIds && test.testMediaIds) {
      // New system: Gallery-based
      return this.rotateV2(testId, targetCase);
    } else {
      // Old system: R2-based
      return this.rotateV1(testId, targetCase);
    }
  }

  async rotateV2(testId: string, targetCase: TestCase) {
    // Gallery-based rotation (fast)
    return rotationServiceV2.rotate(testId, targetCase);
  }

  async rotateV1(testId: string, targetCase: TestCase) {
    // R2-based rotation (slow, with migration attempt)
    const result = await rotationServiceV1.rotate(testId, targetCase);

    // Attempt migration after successful rotation
    if (result.success) {
      backgroundJob.enqueue('migrateTest', { testId });
    }

    return result;
  }
}
```

#### Automatic Migration Triggers

```typescript
// Migrate during idle time
cron.schedule('0 2 * * *', async () => {
  // 2 AM daily migration batch
  const unmigrated = await getUnmigratedTests();

  for (const test of unmigrated.slice(0, 10)) {
    await migrationService.migrateTest(test.id);
  }
});

// Migrate on test edit
export async function handleTestEdit(testId: string) {
  const test = await getTest(testId);

  if (!test.baseMediaIds) {
    // Trigger migration before edit
    await migrationService.migrateTest(testId);
  }

  // Proceed with edit...
}
```

### 4.4 Phase 3: R2 Deprecation (Week 5-6)

**Goal**: Complete removal of R2 dependency

#### Verification & Cleanup

```typescript
class DeprecationService {
  async verifyMigration(): MigrationReport {
    const tests = await getAllTests();

    const report = {
      total: tests.length,
      migrated: 0,
      unmigrated: [],
      missingImages: []
    };

    for (const test of tests) {
      if (test.baseMediaIds && test.testMediaIds) {
        // Verify all media exists
        const valid = await this.validateMedia(test);

        if (valid) {
          report.migrated++;
        } else {
          report.missingImages.push(test.id);
        }
      } else {
        report.unmigrated.push(test.id);
      }
    }

    return report;
  }

  async removeR2Dependencies() {
    // 1. Update environment variables
    delete process.env.R2_ACCESS_KEY;
    delete process.env.R2_SECRET_KEY;
    delete process.env.R2_BUCKET;

    // 2. Remove R2 service files
    await removeFile('/app/services/storage.server.ts');
    await removeFile('/app/services/r2-client.ts');

    // 3. Update imports
    await updateImports();

    // 4. Remove R2 packages
    await exec('npm uninstall @aws-sdk/client-s3');
  }
}
```

#### Code Cleanup Checklist

- [ ] Remove `storage.server.ts` service
- [ ] Remove `uploadR2ImageToShopify` function
- [ ] Remove `permanentUrl` from database schema
- [ ] Remove R2 environment variables
- [ ] Remove AWS SDK dependencies
- [ ] Update all import statements
- [ ] Remove R2-related error handling
- [ ] Update documentation

---

## 5. Implementation Plan

### 5.1 Development Phases

#### Sprint 1: Foundation (Week 1-2)
- [ ] Design new database schema
- [ ] Create MediaGalleryService
- [ ] Build MediaRegistryService
- [ ] Implement RotationServiceV2
- [ ] Unit tests for new services

#### Sprint 2: Migration Tools (Week 2-3)
- [ ] Build R2MigrationService
- [ ] Create migration dashboard UI
- [ ] Implement batch migration logic
- [ ] Add migration monitoring
- [ ] Integration tests

#### Sprint 3: Dual-Mode Support (Week 3-4)
- [ ] Create CompatibilityRotationService
- [ ] Update rotation API endpoints
- [ ] Add feature flags for gradual rollout
- [ ] Implement automatic migration triggers
- [ ] Load testing

#### Sprint 4: Rollout (Week 4-5)
- [ ] Deploy to staging
- [ ] Migrate test merchants
- [ ] Monitor performance metrics
- [ ] Fix edge cases
- [ ] Progressive production rollout

#### Sprint 5: Cleanup (Week 5-6)
- [ ] Complete remaining migrations
- [ ] Remove R2 dependencies
- [ ] Update documentation
- [ ] Performance optimization
- [ ] Final testing

### 5.2 Database Migration Scripts

```sql
-- Step 1: Add new columns
ALTER TABLE "ABTest"
ADD COLUMN "baseMediaIds" TEXT[],
ADD COLUMN "testMediaIds" TEXT[];

-- Step 2: Create TestMedia table
CREATE TABLE "TestMedia" (
  "id" TEXT PRIMARY KEY,
  "testId" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "testCase" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "altText" TEXT,
  "sourceUrl" TEXT,
  "migratedAt" TIMESTAMP,
  CONSTRAINT "TestMedia_testId_fkey"
    FOREIGN KEY ("testId")
    REFERENCES "ABTest"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX "TestMedia_testId_mediaId_key"
ON "TestMedia"("testId", "mediaId");

CREATE INDEX "TestMedia_testId_testCase_idx"
ON "TestMedia"("testId", "testCase");

-- Step 3: Update ABTestVariant
ALTER TABLE "ABTestVariant"
ADD COLUMN "baseHeroMediaId" TEXT,
ADD COLUMN "testHeroMediaId" TEXT;

-- Step 4: Add migration status
ALTER TYPE "TestStatus" ADD VALUE 'MIGRATING';
```

---

## 6. Success Metrics

### 6.1 Key Performance Indicators

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Rotation Success Rate | 85% | 99.9% | Failed rotations / Total rotations |
| Average Rotation Time | 105 seconds | 3 seconds | Time from start to completion |
| Products with No Images | ~15% incidents | 0% | Daily monitoring |
| Infrastructure Cost | $50/month (R2) | $0 | Monthly billing |
| Image Upload Success | 92% | 99.9% | Failed uploads / Total uploads |

### 6.2 Technical Metrics

```typescript
interface PerformanceMetrics {
  // Rotation Performance
  rotationP50: number;      // Target: <2s
  rotationP99: number;      // Target: <5s
  rotationErrors: number;   // Target: <0.1%

  // Migration Progress
  testsTotal: number;
  testsMigrated: number;    // Target: 100%
  imagesTotal: number;
  imagesMigrated: number;   // Target: 100%

  // System Health
  galleryUtilization: number;  // Images per product
  orphanedMedia: number;        // Target: 0
  apiLatency: number;           // Target: <200ms
}
```

### 6.3 User Experience Metrics

- **Merchant Satisfaction**: Survey on reliability improvement
- **Support Tickets**: Reduction in image-related issues
- **Feature Adoption**: Increased A/B test creation
- **Time to Value**: Faster test setup and rotation

---

## 7. Risk Analysis & Mitigation

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Gallery 250-image limit | Medium | High | Implement cleanup for old tests; Archive unused images |
| Migration failures | Medium | Medium | Retry logic; Manual fallback; Gradual rollout |
| MediaId changes | Low | High | Store multiple identifiers; Validation before rotation |
| API rate limits | Low | Medium | Batch operations; Exponential backoff |
| Data loss during migration | Low | High | Backup before migration; Dual-write period |

### 7.2 Rollback Strategy

```typescript
class RollbackService {
  async rollbackTest(testId: string) {
    // 1. Check if old data exists
    const test = await getTest(testId);

    if (test.baseImages && test.testImages) {
      // Has legacy data - can rollback

      // 2. Clear new fields
      await updateTest(testId, {
        baseMediaIds: null,
        testMediaIds: null
      });

      // 3. Force old rotation service
      await rotationServiceV1.rotate(testId, test.currentCase);

      // 4. Log rollback
      await logRollback(testId, 'Manual rollback to V1');

      return { success: true };
    }

    return {
      success: false,
      reason: 'No legacy data available'
    };
  }

  async emergencyRollback() {
    // Global rollback switch
    await setFeatureFlag('USE_GALLERY_ROTATION', false);
    await setFeatureFlag('ENABLE_R2_FALLBACK', true);

    // Alert team
    await notifyOncall('Emergency rollback activated');
  }
}
```

### 7.3 Edge Cases

#### Edge Case 1: Deleted Media
```typescript
// Media deleted from Shopify by merchant
if (!mediaExists(mediaId)) {
  // Attempt to restore from R2 if available
  const backup = await findR2Backup(mediaId);

  if (backup) {
    const newMediaId = await restoreFromBackup(backup);
    await updateMediaMapping(testId, mediaId, newMediaId);
  } else {
    // Mark test as requiring manual intervention
    await flagTestForReview(testId);
  }
}
```

#### Edge Case 2: Duplicate Images
```typescript
// Same image used in multiple test cases
function deduplicateMedia(images: MediaUpload[]) {
  const seen = new Map<string, string>(); // hash -> mediaId

  return images.map(img => {
    const hash = await calculateImageHash(img);

    if (seen.has(hash)) {
      return seen.get(hash); // Reuse existing mediaId
    }

    const mediaId = await uploadToGallery(img);
    seen.set(hash, mediaId);
    return mediaId;
  });
}
```

#### Edge Case 3: Concurrent Rotations
```typescript
// Prevent race conditions
async function rotateWithLock(testId: string, targetCase: TestCase) {
  const lockKey = `rotation:${testId}`;
  const lock = await acquireLock(lockKey, 30000); // 30s timeout

  if (!lock) {
    throw new Error('Rotation already in progress');
  }

  try {
    return await rotateTest(testId, targetCase);
  } finally {
    await releaseLock(lockKey);
  }
}
```

---

## 8. Security & Compliance

### 8.1 Security Considerations

- **Access Control**: MediaIds are GUIDs, not directly accessible
- **Data Privacy**: No PII in image metadata
- **API Security**: All mutations require authenticated admin context
- **Rate Limiting**: Implement client-side throttling

### 8.2 Shopify Compliance

- **API Usage**: Stay within rate limits (2 requests/second)
- **Data Residency**: Images stored in Shopify's infrastructure
- **App Review**: Document changes for Shopify review
- **Billing**: No impact on merchant billing

---

## 9. Documentation Requirements

### 9.1 Technical Documentation

- [ ] API migration guide
- [ ] Database schema changes
- [ ] Service architecture diagrams
- [ ] Deployment runbook
- [ ] Rollback procedures

### 9.2 User Documentation

- [ ] Migration FAQ for merchants
- [ ] Performance improvement highlights
- [ ] New features guide
- [ ] Troubleshooting guide

### 9.3 Code Documentation

```typescript
/**
 * MediaGalleryService handles all interactions with Shopify's media gallery.
 * This service replaces the legacy R2-based storage system.
 *
 * @example
 * const service = new MediaGalleryService(admin);
 * const mediaIds = await service.uploadToGallery(images, productId);
 *
 * @since 2.0.0
 */
class MediaGalleryService {
  // Implementation...
}
```

---

## 10. Timeline & Milestones

### 10.1 Project Timeline (6 weeks)

```
Week 1-2: Foundation & Design
├─ Database schema design
├─ Service architecture
└─ API design

Week 2-3: Core Implementation
├─ MediaGalleryService
├─ RotationServiceV2
└─ Migration tools

Week 3-4: Migration & Testing
├─ R2MigrationService
├─ Dual-mode support
└─ Integration testing

Week 4-5: Rollout
├─ Staging deployment
├─ Test merchant migration
└─ Progressive rollout

Week 5-6: Completion
├─ Production migration
├─ R2 deprecation
└─ Documentation
```

### 10.2 Go/No-Go Criteria

**Week 4 Checkpoint**:
- [ ] 100% unit test coverage
- [ ] Successful staging deployment
- [ ] 5 test merchants migrated successfully
- [ ] Performance targets met (3s rotation)
- [ ] Rollback tested and verified

**Week 6 Launch Criteria**:
- [ ] 95% of tests migrated
- [ ] Zero critical bugs in past 48 hours
- [ ] Documentation complete
- [ ] Team trained on new system
- [ ] Monitoring & alerts configured

---

## 11. Team & Resources

### 11.1 Team Allocation

- **Lead Engineer**: Architecture & core services
- **Backend Engineer**: Migration tools & database
- **Frontend Engineer**: UI updates & dashboard
- **QA Engineer**: Test planning & execution
- **DevOps**: Deployment & monitoring

### 11.2 External Dependencies

- Shopify GraphQL Admin API
- Shopify Media Gallery (250 image limit)
- Database migration tools (Prisma)

---

## 12. Appendix

### A. GraphQL Mutations

```graphql
# Update product media
mutation UpdateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productUpdate(
    input: {
      id: $productId,
      media: $media
    }
  ) {
    product {
      id
      media(first: 250) {
        edges {
          node {
            ... on MediaImage {
              id
              image { url altText }
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}

# Bulk update variants
mutation UpdateVariantHeroes($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(
    productId: $productId,
    variants: $variants
  ) {
    product { id }
    productVariants {
      id
      image { id url }
    }
    userErrors {
      field
      message
    }
  }
}
```

### B. Error Codes & Handling

```typescript
enum MigrationError {
  R2_ACCESS_DENIED = 'R2_ACCESS_DENIED',
  SHOPIFY_UPLOAD_FAILED = 'SHOPIFY_UPLOAD_FAILED',
  GALLERY_LIMIT_REACHED = 'GALLERY_LIMIT_REACHED',
  MEDIA_NOT_FOUND = 'MEDIA_NOT_FOUND',
  ROTATION_LOCK_TIMEOUT = 'ROTATION_LOCK_TIMEOUT'
}

const errorHandlers = {
  [MigrationError.GALLERY_LIMIT_REACHED]: async (test) => {
    await cleanupOldMedia(test.productId);
    return { retry: true };
  },

  [MigrationError.MEDIA_NOT_FOUND]: async (test) => {
    await flagForManualReview(test.id);
    return { retry: false };
  }
};
```

### C. Monitoring & Alerts

```yaml
# DataDog monitors
monitors:
  - name: rotation_success_rate
    metric: custom.rotation.success_rate
    threshold: < 0.95
    alert: pagerduty

  - name: rotation_duration_p99
    metric: custom.rotation.duration.p99
    threshold: > 5000  # 5 seconds
    alert: slack

  - name: migration_progress
    metric: custom.migration.completion_rate
    threshold: < 0.90
    alert: email

  - name: gallery_utilization
    metric: custom.gallery.image_count
    threshold: > 200  # 80% of limit
    alert: slack
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Nov 2024 | Engineering | Initial PRD |

---

## Approval

- [ ] Product Manager
- [ ] Engineering Lead
- [ ] QA Lead
- [ ] Operations

---

**END OF DOCUMENT**