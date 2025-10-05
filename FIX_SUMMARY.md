# App Proxy 404 Fix - Executive Summary

## Problem
Shopify storefront was unable to load the A/B test script, resulting in:
```
Error: No route matches URL "/script"
```

## Root Cause
**Path Mismatch Between Shopify App Proxy and Remix Routes**

Shopify App Proxy automatically strips the configured prefix and subpath before forwarding requests to your app. The routes were named to match the full proxy path instead of the stripped path.

### What Was Happening:
1. Storefront requests: `https://shop.myshopify.com/apps/model-swap/script`
2. Shopify strips `/apps/model-swap` (configured prefix/subpath)
3. App receives: `/script`
4. Remix looks for route: `apps.model-swap.script.tsx` (expects `/apps/model-swap/script`)
5. **Result: 404 Error**

## Solution Applied

### 1. Renamed Route Files
Moved all App Proxy routes to match the stripped paths:

```
app/routes/apps.model-swap.script.tsx       → app/routes/script.tsx
app/routes/apps.model-swap.variant.$productId.tsx → app/routes/variant.$productId.tsx
app/routes/apps.model-swap.track.tsx         → app/routes/track.tsx
app/routes/apps.model-swap.health.tsx        → app/routes/health.tsx
```

### 2. Updated Tunnel URL
Updated `shopify.app.toml` with current tunnel:
- Old: `https://novels-resistant-simple-technical.trycloudflare.com`
- New: `https://inter-interim-archived-adware.trycloudflare.com`

## Verification Steps

### Quick Test
```bash
# Test script endpoint directly
curl https://inter-interim-archived-adware.trycloudflare.com/script

# Should return JavaScript code starting with: (function() {
```

### Full Storefront Test
1. Go to product page on test store
2. Open browser console (DevTools)
3. Look for: `[A/B Test] Script loaded and initialized`
4. If you have an active test, images should be replaced

### Debug Mode
Add `?ab_debug=true` to product URL for detailed logging:
```
[A/B Test Debug] Attempting product ID detection...
[A/B Test Debug] Fetching variant from...
[A/B Test Debug] Variant data received...
```

## Files Changed

**Routes (renamed/moved):**
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/script.tsx`
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/variant.$productId.tsx`
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/track.tsx`
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/health.tsx`

**Configuration:**
- `/Users/javierjrueda/dev/shopify-model-swap-app/shopify.app.toml` (tunnel URL updated)

## Expected Behavior After Fix

### Successful Script Load
```
[A/B Test] Script loaded and initialized
[A/B Test] Initializing on page: /products/test-product
[A/B Test] Product ID detected: gid://shopify/Product/123
[A/B Test] Active test found: test_xyz Variant: A Images: 3
[A/B Test] ✅ Images replaced successfully
```

### No Active Test (Normal)
```
[A/B Test] Script loaded and initialized
[A/B Test] Initializing on page: /products/test-product
[A/B Test] Product ID detected: gid://shopify/Product/123
[A/B Test] No active test for this product
```

## Next Actions Required

1. **Restart dev server** (if running):
   ```bash
   npm run dev
   ```

2. **Test on storefront** to verify script loads

3. **If tunnel URL changed**, Shopify config will auto-update on dev server start

4. **Deploy when ready**:
   ```bash
   npm run deploy --force
   ```

## Technical Details

### How Shopify App Proxy Works
```
Storefront: /apps/model-swap/script
     ↓
Shopify: Strips "/apps/model-swap", validates HMAC
     ↓
Your App: Receives "/script"
     ↓
Remix: Matches app/routes/script.tsx
     ↓
Response: JavaScript file
```

### Authentication
- **App Proxy routes**: Use `authenticate.public.appProxy(request)` (HMAC validation)
- **Admin routes**: Use `authenticate.admin(request)` (OAuth)

### Performance
- Script cached for 5 minutes
- Async/defer loading (non-blocking)
- ~3.5KB minified script size
- Retry logic with exponential backoff

## Troubleshooting

### Script Still Not Loading?
1. Check tunnel is running: `curl https://your-tunnel-url.com/health`
2. Verify App Proxy in Shopify Admin → Apps → App Setup
3. Check browser console for CORS errors
4. Enable debug mode: Add `?ab_debug=true` to URL

### Images Not Replacing?
1. Verify active test exists in admin panel
2. Check product ID detection in console
3. Ensure variant has valid image URLs in database
4. Review selectors in `/public/image-replacer.js` (lines 98-146)

## Documentation
See `/Users/javierjrueda/dev/shopify-model-swap-app/AB_TEST_PROXY_FIX.md` for complete details.

---

**Status:** ✅ Fixed and ready for testing  
**Date:** 2025-10-02  
**Impact:** Critical bug fix - enables A/B testing on storefront
