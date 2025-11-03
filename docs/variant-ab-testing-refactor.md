# Variant-Level A/B Testing Refactor - Working Document

## Current State

- ❌ Creates multiple ABTest records for variant-scoped tests (one per Shopify variant)
- ❌ Frontend expects single test structure
- ❌ Analytics complicated by multiple test records
- ✅ Basic variant detection working
- ✅ Image replacement functional

## Target State

- ✅ ONE ABTest record per test (regardless of variants)
- ✅ Multiple ABTestVariant configs per test
- ✅ Smooth variant switching with preloading
- ✅ Accurate per-variant analytics
- ✅ Clear admin UI

## Data Model Change

### Before (Current - BROKEN):

```
Product with 3 variants → Creates 3 ABTest records
ABTest #1 (for variant1)
  ├── ABTestVariant (A)
  └── ABTestVariant (B)
ABTest #2 (for variant2)
  ├── ABTestVariant (A)
  └── ABTestVariant (B)
ABTest #3 (for variant3)
  ├── ABTestVariant (A)
  └── ABTestVariant (B)
```

### After (Target - CORRECT):

```
Product with 3 variants → Creates 1 ABTest record
ABTest #1 (for entire product)
  ├── ABTestVariant (A, shopifyVariantId=null) [product-wide]
  ├── ABTestVariant (B, shopifyVariantId=null) [product-wide]
  ├── ABTestVariant (A, shopifyVariantId=variant1)
  ├── ABTestVariant (B, shopifyVariantId=variant1)
  ├── ABTestVariant (A, shopifyVariantId=variant2)
  ├── ABTestVariant (B, shopifyVariantId=variant2)
  ├── ABTestVariant (A, shopifyVariantId=variant3)
  └── ABTestVariant (B, shopifyVariantId=variant3)
```

## Implementation Progress

### Phase 1: Backend Data Model Fix ✅ COMPLETE

- [x] 1.1: Update test creation logic in app.ab-tests.tsx
- [x] 1.2: Update variant endpoint query in variant.$productId.tsx
- [x] 1.3: Add database indexes (SQL ready - needs Supabase execution)
- [x] 1.4: Build successful, ready for testing

### Phase 2: Frontend Enhancements

- [ ] 2.1: Image preloading
- [ ] 2.2: Loading states
- [ ] 2.3: Variant caching
- [ ] 2.4: Enhanced tracking

### Phase 3: Admin UI

- [ ] 3.1: Test list view improvements
- [ ] 3.2: Test detail view with variant tabs

## Key Files Modified

- ✅ `/app/routes/app.ab-tests.tsx` - Test creation
- ✅ `/app/routes/variant.$productId.tsx` - Variant serving
- [ ] `/public/ab-test-script.js` - Frontend logic
- [ ] `/app/routes/app.ab-tests.$id.tsx` - Test detail view

## Testing Checklist

- [ ] Create product-wide test → verify 2 variants (A/B) with null shopifyVariantId
- [ ] Create variant-scoped test → verify 2\*N variants (N = number of variants)
- [ ] Switch variants on frontend → verify correct images load
- [ ] Track impression → verify variantId captured
- [ ] View test analytics → verify per-variant stats

## Notes & Decisions

- Keep existing multi-test structure temporarily for backward compatibility
- Add migration path for existing tests
- Use composite querying: (testId + variant + shopifyVariantId)
- Null shopifyVariantId = product-wide test
