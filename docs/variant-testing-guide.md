# Variant A/B Testing - Testing Guide

## Pre-Testing Checklist

- [ ] Development environment running
- [ ] Shopify store connected
- [ ] At least 2 test products created:
  - [ ] Simple product (1 variant)
  - [ ] Product with multiple variants (3+ variants)
- [ ] Test images uploaded and accessible
- [ ] Browser dev tools open (Console tab)

## Test Suite

### Test 1: Backward Compatibility - Simple Product

**Objective**: Verify existing functionality still works

**Steps**:
1. Navigate to simple product (one default variant)
2. Create A/B test using existing UI/API
3. Start the test
4. Visit product page on storefront
5. Check console for: `[A/B Test] Running test...`
6. Verify images changed to A or B set

**Expected Result**:
- ✅ Test created successfully
- ✅ Images replaced on page load
- ✅ No console errors
- ✅ SessionStorage contains test info

**Console Output Should Show**:
```
[A/B Test] Request received: {productId: "...", variantId: null, ...}
[A/B Test] Product-wide test query: {found: true, ...}
[A/B Test] Running test abc123, variant A
[A/B Test] Replaced 4 product images
```

---

### Test 2: Product-Wide Test - Multi-Variant Product

**Objective**: Verify product-wide tests work with variants

**Steps**:
1. Navigate to product with 3+ variants (Red, Blue, Gray)
2. Create test with `variantScope: "PRODUCT"`
3. Start the test
4. Visit product page
5. Switch between variants (Red → Blue → Gray)
6. Verify same A/B test images show for all variants

**Expected Result**:
- ✅ Same images for all variants
- ✅ No additional API calls on variant change
- ✅ Impression tracked only once

**Console Output**:
```
[A/B Test] Running test abc123, variant B
[A/B Test] Variant changed to: 456
[A/B Test] No active test for this product/variant
(Falls back to product-wide test)
```

---

### Test 3: Variant-Specific Test - Single Variant

**Objective**: Test variant-specific image sets

**Setup**:
```javascript
// Create via API
{
  name: "Gray Variant Test",
  productId: "gid://shopify/Product/123",
  variantScope: "VARIANT",
  variantTests: [{
    shopifyVariantId: "gid://shopify/ProductVariant/456", // Gray
    variantAImages: '["gray_a1.jpg","gray_a2.jpg"]',
    variantBImages: '["gray_b1.jpg","gray_b2.jpg"]'
  }]
}
```

**Steps**:
1. Create variant-specific test for "Gray" variant only
2. Start the test
3. Visit product page (default variant)
4. Switch to "Gray" variant
5. Verify different images appear
6. Switch to "Blue" variant
7. Verify default images appear (no test)

**Expected Result**:
- ✅ Gray: Shows gray_a OR gray_b images
- ✅ Blue/Red: Shows default images
- ✅ API called with `variantId` parameter

**Console Output**:
```
[A/B Test] Request received: {variantId: "456", ...}
[A/B Test] Variant-specific test query: {found: true, variantId: "456", ...}
[A/B Test] Running test xyz789, variant A
```

---

### Test 4: Multiple Variant Tests

**Objective**: Test multiple variants with different tests

**Setup**:
```javascript
{
  name: "Multi-Variant Tests",
  productId: "gid://shopify/Product/123",
  variantScope: "VARIANT",
  variantTests: [
    {
      shopifyVariantId: "456", // Gray
      variantAImages: '["gray_a.jpg"]',
      variantBImages: '["gray_b.jpg"]'
    },
    {
      shopifyVariantId: "789", // Red
      variantAImages: '["red_a.jpg"]',
      variantBImages: '["red_b.jpg"]'
    }
    // Blue (999) has no test
  ]
}
```

**Steps**:
1. Create 2 separate variant tests
2. Start both tests
3. Visit product page
4. Switch: Default → Gray → Red → Blue → Gray
5. Verify each variant shows correct images

**Expected Result**:
- ✅ Gray: gray_a OR gray_b
- ✅ Red: red_a OR red_b  
- ✅ Blue: default images
- ✅ Switching back to Gray shows same test images

---

### Test 5: Variant Change Detection

**Objective**: Verify all detection methods work

**Method 1: URL Parameter**
- Navigate to `/products/test-product?variant=456`
- Verify variantId detected in console
- Expected: `getCurrentVariantId() === "456"`

**Method 2: Form Selection**
- Use variant dropdown/buttons
- Check console for variant change
- Expected: `[A/B Test] Variant changed via form: 456`

**Method 3: Theme Events**
- Trigger variant change in theme
- Check if event fired
- Expected: `[A/B Test] Variant changed via event: 456`

---

### Test 6: Impression Tracking

**Objective**: Verify impressions tracked correctly

**Steps**:
1. Clear sessionStorage and cookies
2. Visit product page with active test
3. Check database for new impression event
4. Verify event has correct `variantId`
5. Reload page
6. Verify NO new impression (same session)

**Database Check**:
```sql
SELECT * FROM ABTestEvent 
WHERE testId = 'abc123' 
AND eventType = 'IMPRESSION'
ORDER BY createdAt DESC
LIMIT 5;
```

**Expected**:
- ✅ One impression per session
- ✅ Correct variantId stored
- ✅ Correct variant (A or B) stored

---

### Test 7: Add to Cart Tracking

**Objective**: Verify conversion tracking works

**Steps**:
1. Visit product page with active test
2. Select variant (if multi-variant)
3. Add to cart
4. Check database for ADD_TO_CART event
5. Verify variantId matches selected variant

**Expected**:
- ✅ ADD_TO_CART event created
- ✅ Linked to correct test
- ✅ Correct variantId
- ✅ Same session as impression

---

### Test 8: Performance - Rapid Variant Switching

**Objective**: Test system under rapid changes

**Steps**:
1. Visit product page
2. Rapidly switch variants 10 times
3. Monitor console for errors
4. Check network tab for excessive requests
5. Verify images update correctly

**Expected**:
- ✅ No errors in console
- ✅ Max 10 API calls (one per change)
- ✅ Images update smoothly
- ✅ No memory leaks

---

### Test 9: Edge Cases

#### 9a: No Active Test
- Visit product with no test
- Expected: `[A/B Test] No active test for this product`
- Default images show

#### 9b: Invalid Variant ID
- Navigate to `?variant=99999` (non-existent)
- Expected: Falls back to product test or shows default
- No errors thrown

#### 9c: Missing Images
- Create test with invalid image URLs
- Expected: Images fail to load but no JS errors
- Fallback to default images

#### 9d: Multiple Tabs
- Open product in 2 tabs
- Switch variants independently
- Expected: Each tab tracks independently
- Same sessionId across tabs

---

## Automated Test Script

```javascript
// Run in browser console
async function runVariantTests() {
  console.log('🧪 Starting Variant A/B Testing Suite...\n');
  
  // Test 1: Variant Detection
  console.log('Test 1: Variant Detection');
  const variantId = getCurrentVariantId();
  console.log(variantId ? '✅ PASS' : '❌ FAIL', 'Variant ID:', variantId);
  
  // Test 2: API Call
  console.log('\nTest 2: API Call');
  const productId = getProductId();
  try {
    const response = await fetch(`/apps/model-swap/variant/${encodeURIComponent(productId)}?session=test&variantId=${variantId}`);
    const data = await response.json();
    console.log(data.variant ? '✅ PASS' : '❌ FAIL', 'API Response:', data);
  } catch (error) {
    console.log('❌ FAIL', 'API Error:', error);
  }
  
  // Test 3: SessionStorage
  console.log('\nTest 3: SessionStorage');
  const testData = sessionStorage.getItem('ab_test_active');
  console.log(testData ? '✅ PASS' : '❌ FAIL', 'Test Data:', testData);
  
  console.log('\n✨ Test Suite Complete!');
}

// Run tests
runVariantTests();
```

---

## Debugging Guide

### Issue: Variant not detected

**Debug Steps**:
```javascript
// Check all detection methods
console.log('URL:', new URLSearchParams(window.location.search).get('variant'));
console.log('Form:', document.querySelector('[name="id"]')?.value);
console.log('Analytics:', window.ShopifyAnalytics?.meta?.selectedVariantId);
console.log('Theme:', window.theme?.product?.selected_variant);
```

### Issue: Images not changing

**Debug Steps**:
```javascript
// Check if images replaced
const images = document.querySelectorAll('.product__media img');
console.log('Total images:', images.length);
images.forEach((img, i) => {
  console.log(`Image ${i}:`, img.src, img.dataset.abTestReplaced);
});
```

### Issue: API not called on variant change

**Debug Steps**:
```javascript
// Manually trigger variant change
watchVariantChanges((variantId) => {
  console.log('🔄 Variant changed:', variantId);
  fetchAndApplyVariant(getProductId(), variantId);
});
```

---

## Test Report Template

```markdown
## Variant A/B Testing - Test Report

**Date**: [Date]
**Tester**: [Name]
**Environment**: [Dev/Staging/Prod]

### Test Results

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| Test 1  | Simple Product | ✅ PASS | |
| Test 2  | Product-Wide | ✅ PASS | |
| Test 3  | Variant-Specific | ✅ PASS | |
| Test 4  | Multiple Variants | ⚠️ WARN | Minor delay |
| Test 5  | Detection | ✅ PASS | |
| Test 6  | Impression | ✅ PASS | |
| Test 7  | Add to Cart | ✅ PASS | |
| Test 8  | Performance | ✅ PASS | |
| Test 9  | Edge Cases | ✅ PASS | |

### Issues Found

1. [Issue description]
2. [Issue description]

### Recommendations

1. [Recommendation]
2. [Recommendation]

### Sign-off

- [ ] All critical tests passing
- [ ] No blocking issues
- [ ] Ready for production
```

---

## Next Steps After Testing

1. ✅ All tests pass → Deploy to production
2. ⚠️ Minor issues → Document and deploy
3. ❌ Critical failures → Fix before deploy

## Production Monitoring

After deploy, monitor:
- Error rates in console
- API response times
- Impression/conversion rates
- Browser compatibility issues

