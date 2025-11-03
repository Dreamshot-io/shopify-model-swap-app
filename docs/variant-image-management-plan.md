# Variant Image Management Implementation Plan

## Overview
Enable product variant-specific image management for A/B testing, allowing different images for each variant and automatic image switching when customers select variants on the frontend.

## Current State Analysis

### Existing Infrastructure
- **Database**: Schema supports `shopifyVariantId` in `ABTestVariant` and `variantId` in `ABTestEvent` and `MetricEvent`
- **Backend**: Variant endpoint (`variant.$productId.tsx`) handles product-level A/B tests
- **Frontend**: Script (`ab-test-script.js`) replaces images based on product ID only
- **Extensions**: Separate extensions for product and variant configuration

### Limitations
1. A/B tests are product-scoped, not variant-scoped
2. Frontend doesn't listen for variant selection events
3. No UI for managing variant-specific test configurations

## Implementation Strategy

### Phase 1: Backend Modifications

#### 1.1 Database Schema Updates
**File**: `prisma/schema.prisma`
- Add `variantScope` field to ABTest model (already exists as optional)
- Ensure `shopifyVariantId` in ABTestVariant is properly utilized
- Add migration for any schema changes

#### 1.2 API Endpoint Updates
**File**: `app/routes/variant.$productId.tsx`
- Modify to accept optional variant ID parameter
- Logic to determine test scope (product vs variant)
- Return variant-specific images when applicable

#### 1.3 AB Test Creation/Management
**Files**: 
- `app/routes/app.ab-tests.tsx`
- `app/features/ab-testing/components/ABTestCreator.tsx`
- Add variant selector to test creation flow
- Support for "product-wide" vs "variant-specific" test modes

### Phase 2: Frontend Updates

#### 2.1 Variant Selection Event Handling
**File**: `public/ab-test-script.js`

```javascript
// Listen for variant changes
document.addEventListener('variant:change', function(event) {
  const variantId = event.detail.variant.id;
  handleVariantChange(variantId);
});

// Also monitor form changes for variant selectors
document.querySelectorAll('[name="id"]').forEach(selector => {
  selector.addEventListener('change', function(e) {
    const variantId = e.target.value;
    handleVariantChange(variantId);
  });
});

// Shopify theme-agnostic approach
function detectVariantChange() {
  // Monitor URL changes (some themes update URL with variant)
  let lastVariant = new URLSearchParams(window.location.search).get('variant');
  
  // Poll for changes (fallback for themes without events)
  setInterval(() => {
    const currentVariant = new URLSearchParams(window.location.search).get('variant');
    if (currentVariant !== lastVariant) {
      lastVariant = currentVariant;
      handleVariantChange(currentVariant);
    }
  }, 500);
}
```

#### 2.2 Dynamic Image Replacement
- Fetch variant-specific images when variant changes
- Cache variant images to prevent redundant API calls
- Smooth transition between variant images

### Phase 3: UI Enhancements

#### 3.1 Test Configuration Interface
**Files**:
- `app/features/ab-testing/components/ABTestCreator.tsx`
- `app/features/ab-testing/components/VariantTestSelector.tsx` (new)

Features:
- Toggle between "All Variants" and "Specific Variants" mode
- When "Specific Variants" selected:
  - Show variant selector dropdown
  - Display variant-specific image selection
  - Allow different A/B configurations per variant

#### 3.2 Test Management View
- Display variant-specific test results
- Filter analytics by variant
- Bulk actions for variant tests

## File Modifications Summary

### Backend Files to Modify:
1. `prisma/schema.prisma` - Schema updates
2. `app/routes/variant.$productId.tsx` - API endpoint enhancement
3. `app/routes/app.ab-tests.tsx` - Test management updates
4. `app/routes/app.ab-tests.$id.tsx` - Test detail view updates
5. `app/features/ab-testing/types.ts` - Type definitions

### Frontend Files to Modify:
1. `public/ab-test-script.js` - Variant change detection
2. `app/features/ab-testing/components/ABTestCreator.tsx` - UI for variant tests
3. `app/features/ab-testing/components/ABTestCard.tsx` - Display variant info

### New Files to Create:
1. `app/features/ab-testing/components/VariantTestSelector.tsx` - Variant selection UI
2. `app/features/ab-testing/hooks/useProductVariants.ts` - Variant data fetching
3. `docs/variant-events-reference.md` - Documentation for variant events

## Technical Considerations

### Variant Detection Methods
1. **URL Parameter**: `?variant=123456789`
2. **Form Input**: `<input name="id" value="variant-id">`
3. **Shopify Theme Events**: Custom events vary by theme
4. **DOM Monitoring**: Watch for changes in variant selectors

### Performance Optimizations
- Preload images for all variants on initial load
- Use Intersection Observer for lazy loading
- Cache variant selections in sessionStorage
- Batch API requests for multiple variants

### Compatibility
- Ensure compatibility with major Shopify themes:
  - Dawn
  - Debut
  - Brooklyn
  - Minimal
  - Custom themes

## Migration Path

### For Existing Tests:
1. Default all existing tests to "product-wide" scope
2. Allow merchants to convert to variant-specific
3. Preserve historical data

### Database Migration:
```sql
ALTER TABLE "ABTest" 
ADD COLUMN IF NOT EXISTS "variantScope" TEXT DEFAULT 'PRODUCT';

ALTER TABLE "ABTestVariant"
ADD COLUMN IF NOT EXISTS "shopifyVariantId" TEXT;
```

## Testing Strategy

### Unit Tests:
- Variant detection logic
- Image replacement for specific variants
- API endpoint with variant parameters

### Integration Tests:
- Full flow: variant selection → image update
- Multiple variant switches
- Cache behavior

### E2E Tests:
- Create variant-specific test
- Frontend variant switching
- Analytics tracking per variant

## Rollout Plan

### Phase 1 (Week 1):
- Backend API updates
- Database schema changes
- Basic variant detection

### Phase 2 (Week 2):
- Frontend event handling
- Image replacement logic
- Testing with major themes

### Phase 3 (Week 3):
- UI for variant test creation
- Analytics updates
- Documentation

### Phase 4 (Week 4):
- Beta testing with select merchants
- Performance optimization
- Bug fixes and refinements

## Success Metrics
- Variant change detection accuracy > 95%
- Image replacement latency < 200ms
- No increase in page load time
- Merchant adoption rate > 30% for variant tests

## Questions/Decisions Needed
1. Should we support different traffic splits per variant?
2. How to handle products with 100+ variants?
3. Should variant tests inherit product-level settings?
4. Analytics aggregation: separate or combined views?
5. Migration strategy for existing tests?
