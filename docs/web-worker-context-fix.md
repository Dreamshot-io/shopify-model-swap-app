# Web Worker Context Fix

## Problem

Error: `ReferenceError: window is not defined`

**Root Cause**: Shopify web pixels run in a **Web Worker** context, not in the main window context. This means:
- ❌ No `window` object
- ❌ No `document` object
- ❌ No `navigator` object
- ❌ No DOM access

## Solution Applied

### Removed All DOM/Window Access

**Before** (Broken):
```typescript
const productId = event.data?.product?.id;
if (!productId) {
  // Try meta tag - ❌ FAILS in worker
  const metaProduct = document.querySelector('meta[property="product:id"]');
  // Try window - ❌ FAILS in worker
  productId = window.ShopifyAnalytics?.meta?.product?.id;
  // Try location - ❌ FAILS in worker
  const url = window.location.href;
}
```

**After** (Fixed):
```typescript
// Only use event data - ✅ Works in worker
let productId = event.data?.product?.id ||
                event.data?.productId ||
                event.data?.product?.gid ||
                event.productId ||
                event.data?.id;

// No DOM access - removed all window/document references
```

### What We Can Use

✅ **Available in Worker**:
- `browser.sessionStorage` - Storage API
- `browser.localStorage` - Storage API
- `event.data` - Event payload from Shopify
- `fetch()` - Network requests
- `console.log()` - Logging

❌ **NOT Available in Worker**:
- `window.*` - Window object
- `document.*` - DOM access
- `navigator.*` - Browser info
- `location.*` - URL access (must come from event)

## Event Data Structure

The `product_viewed` event should contain:
```typescript
event.data = {
  product: {
    id: "gid://shopify/Product/123456", // This is what we need
    // ... other product data
  },
  productVariant: {
    id: "gid://shopify/ProductVariant/789",
    // ... variant data
  }
}
```

## Next Steps

1. **Redeploy pixel** to get updated code
2. **Visit product page** with DevTools open
3. **Check console** for full event structure:
   ```
   [A/B Test Pixel] Full product_viewed event: {...}
   ```
4. **Share the event structure** so we can see where productId actually is

## If Event Doesn't Have ProductId

If the event structure doesn't contain productId, we may need to:
1. Subscribe to `all_events` and filter
2. Use a different event type
3. Or rely on the event having URL/product info we can use

But first, let's see what the actual event structure is with the enhanced logging.
