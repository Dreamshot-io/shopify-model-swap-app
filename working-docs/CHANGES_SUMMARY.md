# Changes Summary - Impression Tracking Fix

## Root Cause
Web pixel was using relative URLs that resolved to storefront domain instead of app domain.

## Files Modified

### 1. `/extensions/ab-test-pixel/shopify.extension.toml`
- Added `app_url` setting field to configure app backend URL
- Allows pixel to know where to send API requests

### 2. `/extensions/ab-test-pixel/src/index.ts`
- Updated to use `settings.app_url` for constructing absolute URLs
- Added comprehensive debug logging (enabled via `settings.debug`)
- Added detailed logging at every step:
  - Pixel initialization
  - Product view events
  - API requests and responses
  - Impression tracking logic
  - Event tracking success/failure

### 3. `/app/routes/api.debug-events.ts` (NEW)
- Debug endpoint to inspect event tracking
- Returns event counts, active tests, recent impressions
- Requires admin authentication

### 4. `/extensions/ab-test-pixel/dist/ab-test-pixel.js`
- Rebuilt extension with new changes

## Testing Checklist

- [ ] Deploy extension: `shopify app deploy`
- [ ] Configure pixel settings in Shopify admin
  - [ ] Set app_url to production domain
  - [ ] Enable debug mode
- [ ] Test on storefront
  - [ ] Check console logs
  - [ ] Verify network requests
  - [ ] Confirm impressions in database

## Key URLs

- Debug endpoint: `https://abtest.dreamshot.io/api/debug-events`
- Rotation state: `https://abtest.dreamshot.io/api/rotation-state`
- Track events: `https://abtest.dreamshot.io/track`

## Documentation

See `IMPRESSION_TRACKING_DEBUG_REPORT.md` for full details.
