# ProductId Extraction - FIXED ✅

## Problem Found

The `product_viewed` event structure from Shopify is:
```json
{
  "data": {
    "productVariant": {
      "product": {
        "id": "7821131415621"  // ← Numeric string, NOT GID format!
      },
      "id": "43926530555973"   // ← Variant ID also numeric
    }
  }
}
```

**Issue**: We were looking for `event.data.product.id` but it's actually at `event.data.productVariant.product.id`, and it's numeric, not GID format.

## Solution Applied

### 1. Fixed Extraction Path
```typescript
// ✅ CORRECT - Extract from actual Shopify structure
if (event.data?.productVariant?.product?.id) {
  productId = String(event.data.productVariant.product.id);
}
```

### 2. Normalize to GID Format
```typescript
// Convert numeric ID to GID format
if (/^\d+$/.test(productId)) {
  productId = `gid://shopify/Product/${productId}`;
  // Result: "gid://shopify/Product/7821131415621"
}
```

### 3. Same Fix for VariantId
```typescript
if (event.data?.productVariant?.id) {
  variantId = String(event.data.productVariant.id);
  if (/^\d+$/.test(variantId)) {
    variantId = `gid://shopify/ProductVariant/${variantId}`;
  }
}
```

### 4. Fixed Add-to-Cart Recovery
Also updated `product_added_to_cart` recovery logic to normalize productId/variantId to GID format.

## Expected Behavior Now

1. ✅ Pixel extracts productId from `event.data.productVariant.product.id`
2. ✅ Converts numeric ID to GID format: `gid://shopify/Product/7821131415621`
3. ✅ Calls `/api/rotation-state?productId=gid://shopify/Product/7821131415621`
4. ✅ Gets test state and tracks impression
5. ✅ Event saved to database

## Testing

After redeploy, visit product page and check console:

**Should see**:
```
[A/B Test Pixel] Product viewed - extracted productId: 7821131415621
[A/B Test Pixel] Normalized productId to GID format gid://shopify/Product/7821131415621
[A/B Test Pixel] Fetching test state from https://shopify-txl.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/7821131415621
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
[A/B Test Pixel] Tracking impression
[A/B Test Pixel] Track success
```

## Database Verification

After tracking, check database:
```bash
bun run scripts/check-abtestevents.ts
```

Should show new IMPRESSION events.
