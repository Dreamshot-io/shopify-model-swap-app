# ProductId Extraction Fix

## Problem

Pixel logs show:
```
[A/B Test Pixel] Product viewed Object
[A/B Test Pixel] No productId, skipping
```

**Root Cause**: The `product_viewed` event structure may vary, and `event.data?.product?.id` might not exist.

## Solution Applied

Added multiple fallback methods to extract productId:

### 1. Try Multiple Event Paths
```typescript
let productId = event.data?.product?.id ||
                event.data?.productId ||
                event.data?.product?.gid ||
                event.productId ||
                event.data?.id;
```

### 2. Fallback to Page Elements
If event doesn't have productId:
- Try meta tag: `<meta property="product:id">`
- Try ShopifyAnalytics global: `window.ShopifyAnalytics.meta.product.id`
- Try URL handle (log for debugging)

### 3. Normalize to GID Format
Convert numeric IDs to GID format:
```typescript
if (/^\d+$/.test(productId)) {
  productId = `gid://shopify/Product/${productId}`;
}
```

### 4. Enhanced Logging
Now logs:
- Event structure keys
- All attempted extraction methods
- Full event data (when debug enabled)

## Testing

After fix, visit product page and check console:

**Should see**:
```
[A/B Test Pixel] Product viewed event structure: {
  hasData: true,
  dataKeys: ["product", "variant", ...],
  productId: "gid://shopify/Product/...",
  ...
}
```

**If still no productId**:
- Check `dataKeys` to see what's available
- Check if meta tag exists on page
- Check if ShopifyAnalytics global exists

## Next Steps

1. **Visit product page** with DevTools open
2. **Check console** for event structure
3. **Share the `dataKeys`** array to see what's available
4. **Check Network tab** to see if API calls are made

## Alternative: Subscribe to All Events

If `product_viewed` doesn't work, we can subscribe to `all_events` and filter:

```typescript
analytics.subscribe('all_events', async event => {
  if (event.type === 'product_viewed' || event.name === 'product_viewed') {
    // Extract productId from event
  }
});
```

But first, let's see what the actual event structure is with the enhanced logging.
