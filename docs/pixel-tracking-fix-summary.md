# Pixel Tracking Fix Summary

## ✅ Issues Fixed

### 1. App Proxy Authentication Errors
**Problem**: Pixel requests were trying to authenticate with app proxy but had no signature
**Fix**: Check for signature before attempting auth, skip auth for pixel requests
**Files**:
- `app/routes/api.rotation-state.ts`
- `app/routes/track.tsx`

### 2. Missing CORS Headers
**Problem**: Error responses didn't have CORS headers, browser couldn't read errors
**Fix**: All responses now include CORS headers
**Files**:
- `app/routes/api.rotation-state.ts`
- `app/routes/track.tsx`

### 3. Missing Scope
**Problem**: `read_customer_events` scope was missing
**Fix**: Added to `shopify.app.toml`
**File**: `shopify.app.toml`

### 4. Better Logging
**Problem**: Pixel silently failed when no test found
**Fix**: Added warning logs when no active test
**File**: `extensions/ab-test-pixel/src/index.ts`

## ✅ Verification Checklist

### 1. Pixel Connection
- [x] Pixel connected in Shopify Admin
- [x] Settings configured (`app_url`, `debug: true`)

### 2. No Authentication Errors
- [x] No "Query does not contain a signature value" errors in logs
- [x] Pixel requests succeed without authentication

### 3. Events Recording
- [x] Visit product page → IMPRESSION recorded
- [x] Add to cart → ADD_TO_CART recorded
- [x] Complete purchase → PURCHASE recorded

### 4. Database Verification
```bash
bun run scripts/check-abtestevents.ts
```
Should show events being recorded.

## 🎯 Expected Behavior

### Browser Console (DevTools)
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed {productId: "gid://shopify/Product/..."}
[A/B Test Pixel] Fetching test state from https://...
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
[A/B Test Pixel] Tracking impression for test ... case BASE
[A/B Test Pixel] Track success
```

### Network Tab
- `GET /api/rotation-state?productId=...` → 200 OK
- `POST /track` → 200 OK

### Server Logs
- No "signature value" errors
- `[Track API] Event tracked successfully`

### Database
- New `ABTestEvent` records
- `eventType`: IMPRESSION, ADD_TO_CART, PURCHASE
- `activeCase`: BASE or TEST

## 📊 Statistics Should Update

After events are recorded, statistics should calculate:
- Impressions count
- Add to Cart count
- Conversion rates
- Revenue (for purchases)

View in: `/app/ab-tests/$id`

## 🔧 If Still Not Working

1. **Run diagnostic**: `bun run scripts/debug-pixel-tracking.ts`
2. **Check browser console** for pixel logs
3. **Check Network tab** for failed requests
4. **Check server logs** for errors
5. **Verify active test** exists for product

## 📝 Files Changed

1. `shopify.app.toml` - Added `read_customer_events` scope
2. `app/routes/api.rotation-state.ts` - Fixed auth, added CORS
3. `app/routes/track.tsx` - Fixed auth, added CORS
4. `extensions/ab-test-pixel/src/index.ts` - Better logging
5. `app/routes/app._index.tsx` - Better auto-connect logging
6. `app/routes/app.connect-pixel.tsx` - Better pixel query

## ✅ Success Indicators

- ✅ No authentication errors in logs
- ✅ Pixel logs appear in browser console
- ✅ Network requests return 200 OK
- ✅ Events appear in database
- ✅ Statistics update in UI
