# How to Use Variant-Level A/B Testing

## Quick Start

### For Simple Products (One Variant)
Works exactly as before - no changes needed!

```javascript
// Create test via API or existing UI
{
  name: "Simple Product Test",
  productId: "gid://shopify/Product/123",
  variantAImages: ["url1", "url2"],
  variantBImages: ["url3", "url4"]
}
```

### For Products with Multiple Variants

#### Option 1: Product-Wide Test (Same test for all variants)
```javascript
{
  name: "T-Shirt Test",
  productId: "gid://shopify/Product/123",
  variantScope: "PRODUCT",
  variantAImages: ["url1", "url2"],
  variantBImages: ["url3", "url4"]
}
```

Result: All variants (Red, Blue, Gray) show the same A/B test

#### Option 2: Variant-Specific Tests (Different tests per variant)
```javascript
{
  name: "T-Shirt Color-Specific Tests",
  productId: "gid://shopify/Product/123",
  variantScope: "VARIANT",
  variantTests: [
    {
      shopifyVariantId: "gid://shopify/ProductVariant/456", // Gray variant
      variantAImages: ["gray_a1.jpg", "gray_a2.jpg"],
      variantBImages: ["gray_b1.jpg", "gray_b2.jpg"]
    },
    {
      shopifyVariantId: "gid://shopify/ProductVariant/789", // Red variant  
      variantAImages: ["red_a1.jpg", "red_a2.jpg"],
      variantBImages: ["red_b1.jpg", "red_b2.jpg"]
    }
    // Blue variant (ID 999) has NO test - will show default images
  ]
}
```

Result:
- Gray variant: Customers see gray_a OR gray_b images (50/50)
- Red variant: Customers see red_a OR red_b images (50/50)
- Blue variant: All customers see default product images (no test)

## API Reference

### Create Product-Wide Test
```bash
POST /apps/model-swap/...your-endpoint
Content-Type: application/json

{
  "intent": "create",
  "name": "My Test",
  "productId": "gid://shopify/Product/123",
  "variantScope": "PRODUCT",
  "variantAImages": "[\"url1\",\"url2\"]",
  "variantBImages": "[\"url3\",\"url4\"]"
}
```

### Create Variant-Specific Tests
```bash
POST /apps/model-swap/...your-endpoint
Content-Type: application/json

{
  "intent": "create",
  "name": "Variant Tests",
  "productId": "gid://shopify/Product/123",
  "variantScope": "VARIANT",
  "variantTests": "[{\"shopifyVariantId\":\"456\",\"variantAImages\":\"[\\\"url1\\\"]\",\"variantBImages\":\"[\\\"url2\\\"]\"}]"
}
```

## Frontend Behavior

### For Customers

1. **Land on product page**
   - System detects current variant (or default)
   - Fetches appropriate A/B test
   - Shows A or B images (50/50 split)

2. **Click different variant (e.g., change color)**
   - System detects variant change automatically
   - Fetches test for new variant
   - Updates images instantly

3. **Variant without test**
   - Shows default product images
   - No A/B testing applied

### Theme Compatibility

Works with:
- Dawn (Shopify reference theme)
- Debut
- Brooklyn
- Most custom themes

Detection methods:
- URL parameters (?variant=123)
- Form inputs
- Shopify globals
- Theme events

## Testing Your Implementation

### Step 1: Verify Variant Detection
```javascript
// Open browser console on product page
console.log('Current variant:', getCurrentVariantId());

// Click different variants and check console
// Should log: "[A/B Test] Variant changed to: 123"
```

### Step 2: Test Image Replacement
1. Create an A/B test for a product
2. Start the test
3. Visit product page
4. Check browser console for: "[A/B Test] Running test..."
5. Verify images changed

### Step 3: Test Variant Switching
1. Product with multiple variants
2. Create variant-specific test for one variant
3. Switch between variants on frontend
4. Verify images change only for tested variant

## Common Scenarios

### Scenario 1: New Product Launch
Test hero images across all variants:
```javascript
{
  name: "New Product Launch",
  variantScope: "PRODUCT",
  variantAImages: ["hero_v1.jpg"],
  variantBImages: ["hero_v2.jpg"]
}
```

### Scenario 2: Color-Specific Testing
Test different lifestyle images per color:
```javascript
{
  name: "Color Lifestyle Tests",
  variantScope: "VARIANT",
  variantTests: [
    {
      shopifyVariantId: "gray_variant_id",
      variantAImages: ["gray_lifestyle_1.jpg"],
      variantBImages: ["gray_lifestyle_2.jpg"]
    },
    {
      shopifyVariantId: "blue_variant_id",
      variantAImages: ["blue_lifestyle_1.jpg"],
      variantBImages: ["blue_lifestyle_2.jpg"]
    }
  ]
}
```

### Scenario 3: Best-Seller Only
Test only your best-selling variant:
```javascript
{
  name: "Best Seller Gray Test",
  variantScope: "VARIANT",
  variantTests: [
    {
      shopifyVariantId: "bestseller_variant_id",
      variantAImages: ["test_a.jpg"],
      variantBImages: ["test_b.jpg"]
    }
    // Other variants show default images
  ]
}
```

## Analytics

### View Results
Analytics automatically track which variant was involved:
- Product-wide tests: Combined across all variants
- Variant-specific tests: Separate tracking per variant

### Events Tracked
- `IMPRESSION`: User saw the variant images
- `ADD_TO_CART`: User added product to cart
- `PURCHASE`: User completed purchase

Each event includes:
- `variantId`: Shopify product variant ID
- `variant`: Test group (A or B)
- `testId`: Test identifier

## Troubleshooting

### Images not changing
1. Check browser console for errors
2. Verify test is "RUNNING" status
3. Check variantId is being detected
4. Verify image URLs are accessible

### Variant changes not detected
1. Check console for "[A/B Test] Variant changed" messages
2. Try adding `?variant=123` to URL manually
3. Verify theme uses standard Shopify patterns
4. Check if theme has custom variant switcher

### Wrong images showing
1. Verify `shopifyVariantId` matches actual variant
2. Check if multiple tests exist for same product
3. Verify test status is "RUNNING"
4. Clear browser cache and sessionStorage

## Best Practices

1. **Start with product-wide tests** - Simpler and faster to set up
2. **Use variant tests for high-value variants** - Focus on bestsellers
3. **Keep image sets distinct** - Clear visual difference between A and B
4. **Test one thing at a time** - Don't change multiple variants simultaneously
5. **Monitor performance** - Variant detection adds minimal overhead but monitor anyway
6. **Document your tests** - Note which variants have tests active

## Migration from Old System

### Existing Tests
- Automatically treated as product-wide (variantScope = "PRODUCT")
- Continue working without changes
- No migration needed

### New Tests
- Choose scope when creating:
  - `PRODUCT`: Old behavior (all variants)
  - `VARIANT`: New behavior (per-variant)

## Limits & Constraints

- **Traffic Split**: Always 50/50 (hardcoded)
- **Variants per Product**: No limit
- **Images per Variant**: 6 maximum (existing limit)
- **Active Tests**: 1 per product (existing limit)
- **Variant Tests**: Multiple variants can have tests under one product test

## Need Help?

1. Check browser console for debug messages
2. Review `docs/variant-events-reference.md` for technical details
3. See `docs/variant-implementation-summary.md` for architecture
4. Test on `/products/your-product?variant=123` with specific variant ID
