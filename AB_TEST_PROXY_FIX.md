# App Proxy Routing Fix - Complete Report

## Issue Diagnosed

### Root Cause
The App Proxy routing was failing with a 404 error because of a path mismatch between what Shopify App Proxy sends and what Remix expected.

**The Problem:**
1. Theme extension loads script from: `https://shop.myshopify.com/apps/model-swap/script`
2. Shopify App Proxy configuration: `prefix = "apps"`, `subpath = "model-swap"`
3. **Shopify strips the prefix/subpath** and forwards ONLY `/script` to the app
4. Route file `apps.model-swap.script.tsx` expects `/apps/model-swap/script`
5. Result: **404 - No route matches URL "/script"**

### Why This Happens
Shopify App Proxy automatically removes the configured prefix and subpath before forwarding the request to your app. This is by design - the app receives the "clean" path without the proxy prefix.

## Fixes Applied

### 1. Route Files Renamed (CRITICAL FIX)
Moved all App Proxy routes to match what Shopify actually sends:

| Old Route File | New Route File | Actual Path Received |
|---------------|---------------|---------------------|
| `apps.model-swap.script.tsx` | `script.tsx` | `/script` |
| `apps.model-swap.variant.$productId.tsx` | `variant.$productId.tsx` | `/variant/:productId` |
| `apps.model-swap.track.tsx` | `track.tsx` | `/track` |
| `apps.model-swap.health.tsx` | `health.tsx` | `/health` |

**Location:** `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/`

### 2. Tunnel URL Updated
Updated `shopify.app.toml` with new tunnel URL:

**Old:** `https://novels-resistant-simple-technical.trycloudflare.com`  
**New:** `https://inter-interim-archived-adware.trycloudflare.com`

Updated in 3 locations:
- `application_url`
- `app_proxy.url`
- `auth.redirect_urls` (all 3 URLs)

**File:** `/Users/javierjrueda/dev/shopify-model-swap-app/shopify.app.toml`

## How App Proxy Works

```
┌─────────────────────────────────────────────────────────────┐
│  Storefront Request                                          │
│  https://shop.myshopify.com/apps/model-swap/script          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Shopify App Proxy                                           │
│  - Validates HMAC signature                                  │
│  - Strips prefix "/apps/model-swap"                         │
│  - Forwards to: https://your-app.com/script                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Your App (Remix)                                            │
│  - Receives request for: /script                             │
│  - Route file: app/routes/script.tsx                         │
│  - Returns JavaScript file                                   │
└─────────────────────────────────────────────────────────────┘
```

## Testing Instructions

### 1. Restart Dev Server
```bash
npm run dev
```

### 2. Update Shopify App Configuration
The tunnel URL has changed, so you need to update Shopify's configuration:

```bash
# The dev server should auto-update, but if not:
npm run config:link
```

### 3. Test the Script Endpoint

**Direct Test (from terminal):**
```bash
curl "https://inter-interim-archived-adware.trycloudflare.com/script"
```

**Expected Output:**
- JavaScript code starting with `(function() {`
- Should see the image replacer script content
- Headers should include `Content-Type: application/javascript`

### 4. Test on Storefront

**a) Check Script Loading:**
1. Go to your test store product page
2. Open browser DevTools → Console
3. Look for: `[A/B Test] Script loaded and initialized`

**b) Enable Debug Mode:**
1. Add `?ab_debug=true` to product URL
2. Console should show detailed logs:
   - `[A/B Test Debug] Attempting product ID detection...`
   - `[A/B Test Debug] Fetching variant from...`
   - `[A/B Test Debug] Variant data received...`

**c) Verify Image Replacement:**
1. Ensure you have an active A/B test for the product
2. Product images should be replaced with test variant images
3. Console should show: `[A/B Test] ✅ Images replaced successfully`

### 5. Test Variant Endpoint

**Direct Test:**
```bash
curl "https://inter-interim-archived-adware.trycloudflare.com/variant/gid://shopify/Product/123?session=test_session"
```

**Expected Response:**
```json
{
  "variant": "A",
  "imageUrls": ["https://..."],
  "testId": "..."
}
```

Or if no active test:
```json
{
  "variant": null
}
```

### 6. Verify in Theme Extension

The theme extension at `/extensions/ab-test-loader/blocks/ab-test-script.liquid` loads the script:

```liquid
{% if template.name == 'product' %}
  <script src="{{ 'https://' | append: shop.domain | append: '/apps/model-swap/script' }}" async defer></script>
{% endif %}
```

This generates: `https://shop.myshopify.com/apps/model-swap/script`  
Which Shopify proxies to: `https://your-app.com/script`

## Expected Console Output

### Successful Test Flow
```
[A/B Test] Script loaded and initialized
[A/B Test] Initializing on page: /products/test-product
[A/B Test] Product ID detected: gid://shopify/Product/123 (via ShopifyAnalytics)
[A/B Test] Active test found: test_xyz123 Variant: A Images: 3
[A/B Test] ✅ Images replaced successfully
```

### No Active Test
```
[A/B Test] Script loaded and initialized
[A/B Test] Initializing on page: /products/test-product
[A/B Test] Product ID detected: gid://shopify/Product/123 (via ShopifyAnalytics)
[A/B Test] No active test for this product
```

### Debug Mode Output
```
[A/B Test] Script loaded and initialized (debug mode ON)
[A/B Test] Initializing on page: /products/test-product
[A/B Test Debug] Attempting product ID detection...
[A/B Test Debug] Existing session ID: session_abc123def456
[A/B Test] Product ID detected: gid://shopify/Product/123 (via ShopifyAnalytics)
[A/B Test Debug] Fetching variant from: /apps/model-swap/variant/... Attempt: 1
[A/B Test Debug] Response status: 200
[A/B Test Debug] Variant data received: {variant: "A", imageUrls: [...], testId: "..."}
[A/B Test] Active test found: test_xyz123 Variant: A Images: 3
[A/B Test] ✅ Images replaced successfully
```

## Files Changed

### Routes Renamed
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/script.tsx` (was apps.model-swap.script.tsx)
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/variant.$productId.tsx` (was apps.model-swap.variant.$productId.tsx)
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/track.tsx` (was apps.model-swap.track.tsx)
- `/Users/javierjrueda/dev/shopify-model-swap-app/app/routes/health.tsx` (was apps.model-swap.health.tsx)

### Configuration Updated
- `/Users/javierjrueda/dev/shopify-model-swap-app/shopify.app.toml`
  - Updated `application_url`
  - Updated `app_proxy.url`
  - Updated all `auth.redirect_urls`

## Troubleshooting

### If Script Still Doesn't Load

1. **Check tunnel is running:**
   ```bash
   curl https://inter-interim-archived-adware.trycloudflare.com/health
   ```

2. **Verify App Proxy configuration in Shopify:**
   - Go to: Shopify Admin → Apps → App Setup → App Proxy
   - Should show: Subpath = `model-swap`, Prefix = `apps`

3. **Check for CORS errors:**
   - Script route includes: `"Access-Control-Allow-Origin": "*"`
   - Should allow loading from any storefront

4. **Verify theme extension is enabled:**
   ```bash
   npm run shopify theme extension list
   ```

### If Images Don't Replace

1. **Enable debug mode:** Add `?ab_debug=true` to URL
2. **Check product ID detection:** Look for log with detected product ID
3. **Verify active test exists:** Check admin panel for running tests
4. **Inspect selectors:** The script tries 40+ different selectors
5. **Check image URLs:** Verify variant has valid imageUrls in database

### Common Issues

**Issue:** "No route matches URL '/script'"  
**Fix:** ✅ FIXED - Routes renamed to match App Proxy paths

**Issue:** Tunnel URL changes on restart  
**Fix:** Update `shopify.app.toml` and run `npm run config:link`

**Issue:** HMAC validation fails  
**Fix:** Ensure using `authenticate.public.appProxy(request)` in route handlers

**Issue:** Images don't replace  
**Fix:** Check theme selectors in `/public/image-replacer.js` lines 98-146

## Architecture Notes

### Why Separate Routes?
- App Proxy routes handle PUBLIC storefront requests (no Shopify admin auth)
- Admin routes (app.*) handle PRIVATE admin panel requests (require auth)
- Different authentication methods: `authenticate.public.appProxy()` vs `authenticate.admin()`

### Script Loading Strategy
1. **Theme extension** loads script on product pages only
2. **Script route** serves lightweight JavaScript (~3.5KB minified)
3. **Script runs** in main thread (not Web Pixel worker) for DOM access
4. **Variant endpoint** provides A/B test data via App Proxy
5. **Web Pixels** handle tracking separately (sandbox restrictions)

### Performance Considerations
- Script is cached for 5 minutes (`Cache-Control: max-age=300`)
- Async/defer loading prevents blocking page render
- Mutation observer runs for only 5 seconds
- Retry logic with exponential backoff (max 3 attempts)

## Next Steps

1. **Deploy to production:**
   ```bash
   npm run deploy --force
   ```

2. **Monitor script performance:**
   - Check Network tab for script load time
   - Monitor Console for errors
   - Track A/B test metrics in admin panel

3. **Consider using permanent tunnel:**
   - Cloudflare Tunnel with custom domain
   - Ngrok with reserved domain
   - Update `shopify.app.toml` with permanent URL

## Additional Resources

- [Shopify App Proxy Documentation](https://shopify.dev/docs/apps/online-store/app-proxies)
- [Remix Resource Routes](https://remix.run/docs/en/main/guides/resource-routes)
- [Theme App Extensions](https://shopify.dev/docs/apps/online-store/theme-app-extensions)

---

**Fix completed:** 2025-10-02  
**Status:** ✅ Routes fixed, tunnel URL updated, ready for testing
