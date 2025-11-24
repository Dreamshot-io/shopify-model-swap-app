# A/B Test Impression Tracking - Root Cause Analysis

## Executive Summary

**Root Cause Found**: The web pixel extension was using **relative URLs** to call API endpoints, which resolved to the storefront domain instead of the app backend domain.

**Status**: FIXED - Pixel updated to use absolute URLs with app domain

## The Problem

Impressions showed 0 even though:
- Database schema was correct (`activeCase` field)
- TypeScript types were fixed
- API endpoints existed and were functional
- Extension was built and deployed

## Root Cause Analysis

### How Web Pixels Work
- Web pixels run on the **customer storefront** (e.g., `genlabs-dev-store.myshopify.com`)
- They need to call the **app backend** (e.g., `abtest.dreamshot.io`)
- Relative URLs like `/api/rotation-state` resolve to the storefront domain, not the app domain

### The Bug
```typescript
// ❌ BEFORE (in extensions/ab-test-pixel/src/index.ts)
const ROTATION_API = '/api/rotation-state';  // Resolves to storefront domain!
const TRACK_API = '/track';                   // Resolves to storefront domain!
```

When a customer viewed a product:
1. Pixel tried to call `genlabs-dev-store.myshopify.com/api/rotation-state` ❌
2. This endpoint doesn't exist on the storefront
3. Request failed silently (no error logging)
4. No test state retrieved
5. No impression tracked

### The Fix
```typescript
// ✓ AFTER
const APP_URL = settings.app_url || '';  // Get from pixel settings
const ROTATION_API = `${APP_URL}/api/rotation-state`;  // Full URL!
const TRACK_API = `${APP_URL}/track`;                   // Full URL!
```

Now the pixel calls:
1. `abtest.dreamshot.io/api/rotation-state` ✓
2. Receives test state
3. Tracks impression to `abtest.dreamshot.io/track` ✓
4. Event saved to database ✓

## Changes Made

### 1. Updated Extension Configuration
**File**: `/extensions/ab-test-pixel/shopify.extension.toml`

Added new setting for app URL:
```toml
[settings.fields.app_url]
name = "App URL"
description = "The URL of your Shopify app backend (e.g., https://abtest.dreamshot.io)"
type = "single_line_text_field"
```

### 2. Updated Pixel Code
**File**: `/extensions/ab-test-pixel/src/index.ts`

Changes:
- Added `settings` parameter to register function
- Construct absolute URLs using `settings.app_url`
- Added comprehensive debug logging (enabled via `settings.debug`)
- Added detailed error logging at each step

Debug logging includes:
- Pixel initialization with URLs
- Product view events
- API request/response details
- Impression tracking logic
- Event tracking payloads and responses

### 3. Added Debug Endpoint
**File**: `/app/routes/api.debug-events.ts`

Provides visibility into:
- Total event counts by type and case
- Recent impressions
- Active tests with event counts
- All recent events

## Testing Steps

### 1. Deploy Updated Extension
```bash
cd /Users/txemaleon/Developer/Work/Dreamshot/shopify-model-swap-app
shopify app deploy
```

### 2. Configure Pixel Settings in Shopify Admin

Navigate to: **Settings > Customer events > Web pixels > ab-test-pixel**

Set the following values:
- **App URL**: `https://abtest.dreamshot.io` (your production domain)
- **Debug Mode**: `true` (for testing, disable in production)
- **Enable A/B Testing**: `true`

### 3. Test on Storefront

1. Open a product page that has an active A/B test
2. Open browser DevTools console
3. Look for debug logs:

Expected console output:
```
[A/B Test Pixel] Initialized { APP_URL: "https://abtest.dreamshot.io", ... }
[A/B Test Pixel] Product viewed { productId: "gid://shopify/Product/XXX", ... }
[A/B Test Pixel] Fetching test state from https://abtest.dreamshot.io/api/rotation-state?productId=...
[A/B Test Pixel] Response status 200
[A/B Test Pixel] Test state result { testId: "clxxx", activeCase: "BASE", ... }
[A/B Test Pixel] Tracking impression for test clxxx case BASE
[A/B Test Pixel] Track response status 200
[A/B Test Pixel] Track success { success: true, eventId: "clyyy", ... }
```

4. Check Network tab:
   - Should see GET to `https://abtest.dreamshot.io/api/rotation-state`
   - Should see POST to `https://abtest.dreamshot.io/track`
   - Both should return 200 OK

### 4. Verify Database

Query the database (or use `/api/debug-events`):
```sql
SELECT COUNT(*) FROM "ABTestEvent" WHERE eventType = 'IMPRESSION';
```

Should show increasing impression counts.

## API Endpoints Documentation

### GET /api/rotation-state

**Purpose**: Returns current A/B test state for a product

**Parameters**:
- `productId` (required): Shopify product GID
- `variantId` (optional): Shopify variant GID

**Response**:
```json
{
  "testId": "clxxx",
  "activeCase": "BASE",  // or "TEST"
  "variantCase": null    // or "BASE"/"TEST" for variant tests
}
```

**CORS**: Publicly accessible with `Access-Control-Allow-Origin: *`

### POST /track

**Purpose**: Track customer events (impressions, add-to-cart, purchases)

**Body**:
```json
{
  "testId": "clxxx",
  "sessionId": "session_abc123",
  "eventType": "IMPRESSION",  // or "ADD_TO_CART", "PURCHASE"
  "activeCase": "BASE",        // or "TEST"
  "productId": "gid://shopify/Product/XXX",
  "variantId": "gid://shopify/ProductVariant/YYY",
  "revenue": 29.99,           // for PURCHASE events
  "quantity": 1,              // for ADD_TO_CART and PURCHASE
  "metadata": {               // optional context
    "referrer": "https://...",
    "pageUrl": "https://..."
  }
}
```

**Response**:
```json
{
  "success": true,
  "eventId": "clyyy",
  "activeCase": "BASE",
  "message": "IMPRESSION event tracked successfully"
}
```

**CORS**: Publicly accessible with `Access-Control-Allow-Origin: *`

### GET /api/debug-events

**Purpose**: Debug endpoint to inspect event tracking

**Authentication**: Requires Shopify admin session

**Response**:
```json
{
  "summary": {
    "totalEvents": 42,
    "eventCounts": [
      { "eventType": "IMPRESSION", "activeCase": "BASE", "_count": { "id": 20 } },
      { "eventType": "IMPRESSION", "activeCase": "TEST", "_count": { "id": 22 } }
    ]
  },
  "activeTests": [...],
  "recentImpressions": [...],
  "allEvents": [...]
}
```

## Common Issues & Solutions

### Issue 1: No Debug Logs in Console
**Cause**: Debug mode not enabled
**Solution**: Set `debug = "true"` in pixel settings

### Issue 2: CORS Errors
**Cause**: App URL not configured correctly
**Solution**: Ensure `app_url` in pixel settings matches your app's domain exactly

### Issue 3: 404 Errors
**Cause**: Wrong app URL or routes not deployed
**Solution**:
- Verify app URL is correct (check shopify.app.toml `application_url`)
- Ensure latest version is deployed to Shopify

### Issue 4: Impressions Still Not Tracking
**Checklist**:
- [ ] Extension built? (`bun run build` in extension folder)
- [ ] Extension deployed? (`shopify app deploy`)
- [ ] Pixel enabled in Shopify admin?
- [ ] App URL configured in pixel settings?
- [ ] Active test exists for the product?
- [ ] Test status is "ACTIVE"?
- [ ] Product ID matches test productId?

## Files Modified

1. `/extensions/ab-test-pixel/shopify.extension.toml` - Added app_url setting
2. `/extensions/ab-test-pixel/src/index.ts` - Use absolute URLs, add debug logging
3. `/app/routes/api.debug-events.ts` - New debug endpoint
4. `/extensions/ab-test-pixel/dist/ab-test-pixel.js` - Rebuilt extension

## Next Steps

1. **Deploy Extension**
   ```bash
   shopify app deploy
   ```

2. **Configure Pixel Settings**
   - Go to Shopify Admin > Settings > Customer events > Web pixels
   - Find "ab-test-pixel"
   - Set app_url to your production domain
   - Enable debug mode for testing

3. **Test on Storefront**
   - Visit a product with active A/B test
   - Check console for debug logs
   - Verify network requests
   - Check database for events

4. **Monitor in Production**
   - Use `/api/debug-events` to monitor event counts
   - Check A/B test statistics page
   - Disable debug mode once confirmed working

## Lessons Learned

1. **Web pixels run on the storefront**, not in the Shopify admin
2. **Relative URLs don't work** for cross-origin API calls
3. **Settings are crucial** for configuring runtime behavior
4. **Debug logging is essential** for diagnosing pixel issues
5. **CORS must be enabled** for public API endpoints
6. **Always test the full flow** from storefront to database

## References

- Web Pixel Extension Docs: https://shopify.dev/docs/api/web-pixels-api
- Customer Events: https://shopify.dev/docs/apps/marketing/pixels
- CORS Configuration: Handled in `/app/routes/api.rotation-state.ts` and `/app/routes/track.tsx`
