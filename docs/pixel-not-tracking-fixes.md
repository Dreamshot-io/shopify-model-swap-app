# Pixel Connected But Events Not Recording - Debug Guide

## Quick Diagnosis

Run this first:
```bash
bun run scripts/debug-pixel-tracking.ts
```

## Most Common Causes

### 1. **No Active Test for Product** ⚠️ MOST COMMON

**Symptom**: Pixel fires but no events recorded

**Check**:
- Is there an ACTIVE test for the product you're viewing?
- Test status must be `ACTIVE` or `PAUSED` (not `DRAFT`)

**Fix**:
1. Go to `/app/ab-tests`
2. Create or activate a test for the product
3. Test must be `ACTIVE` status

**Why**: If `/api/rotation-state` returns `{ testId: null }`, the pixel won't track impressions.

### 2. **Product ID Mismatch** ⚠️ VERY COMMON

**Symptom**: Pixel logs show productId but API returns null

**Check**:
- Pixel sends: `event.data?.product?.id` (Shopify GID format)
- Test has: `productId` field in database
- Must match EXACTLY including `gid://shopify/Product/` prefix

**Example**:
- ✅ Correct: `gid://shopify/Product/7821131415621`
- ❌ Wrong: `7821131415621` (missing prefix)
- ❌ Wrong: `gid://shopify/Product/7821131415622` (wrong ID)

**Fix**:
1. Check pixel console logs for actual productId
2. Verify test.productId matches exactly
3. Update test if needed

### 3. **API Endpoint Not Accessible** ⚠️ COMMON

**Symptom**: Network errors in browser console

**Check**:
- Open DevTools → Network tab
- Look for failed requests to `/api/rotation-state` or `/track`
- Check for CORS errors

**Fix**:
1. Verify `app_url` in pixel settings matches `SHOPIFY_APP_URL`
2. Check server is running
3. Verify endpoints exist:
   - `/api/rotation-state` ✅
   - `/track` ✅

### 4. **Pixel Not Actually Firing** ⚠️ CHECK FIRST

**Symptom**: No console logs at all

**Check**:
1. Open DevTools (F12) → Console
2. Visit product page
3. Look for `[A/B Test Pixel]` logs

**If NO logs**:
- Pixel not connected (check Shopify Admin)
- Debug mode disabled (enable in pixel settings)
- Wrong product page (not a product page)

**Fix**:
1. Visit `/app/connect-pixel`
2. Verify pixel exists
3. Enable debug mode
4. Clear browser cache

### 5. **Test State Fetch Fails Silently** ⚠️ HARD TO DETECT

**Symptom**: Pixel logs show "Product viewed" but no "Tracking impression"

**Check**:
- Look for "Fetching test state" log
- Check if "Test state result" shows `testId: null`
- Check Network tab for `/api/rotation-state` response

**Why**: If API returns `{ testId: null }`, pixel stops and doesn't track.

**Fix**:
- Ensure test exists and is ACTIVE
- Verify productId matches exactly

### 6. **Track Endpoint Validation Fails** ⚠️ CHECK SERVER LOGS

**Symptom**: Pixel sends request but no event in database

**Check server logs** for:
- `[Track API] Missing required fields`
- `[Track API] Invalid event type`
- `[Track API] Test not found`
- `[Track API] Database error`

**Common validation failures**:
- Missing `testId` (test state fetch failed)
- Missing `sessionId` (localStorage issue)
- Missing `activeCase` (test state incomplete)
- Test not found (productId mismatch or test deleted)

**Fix**:
- Check server logs for specific error
- Verify all required fields are present
- Check test exists in database

## Step-by-Step Debugging

### Step 1: Verify Pixel is Firing

1. Open DevTools (F12) → Console
2. Visit product page with active test
3. Should see:
   ```
   [A/B Test Pixel] Initialized
   [A/B Test Pixel] Product viewed {productId: "..."}
   ```

**If NO logs**: Pixel not connected or debug disabled

### Step 2: Check Test State Fetch

Look for:
```
[A/B Test Pixel] Fetching test state from https://...
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
```

**If `testId: null`**:
- No active test for this product
- ProductId mismatch
- Check `/api/rotation-state` response

### Step 3: Check Impression Tracking

Look for:
```
[A/B Test Pixel] Tracking impression for test ... case BASE
[A/B Test Pixel] Track success
```

**If missing**: Test state fetch failed or returned null

### Step 4: Check Network Requests

DevTools → Network → Filter: XHR/Fetch

Should see:
1. `GET /api/rotation-state?productId=...` ✅
   - Status: 200
   - Response: `{ testId: "...", activeCase: "BASE" }`

2. `POST /track` ✅
   - Status: 200
   - Response: `{ success: true, eventId: "..." }`

**If requests fail**:
- Check CORS headers
- Verify `app_url` setting
- Check server logs

### Step 5: Check Server Logs

Look for:
```
[Track API] Event tracked successfully
```

**If errors**:
- `Missing required fields` → Check payload
- `Test not found` → Verify test exists
- `Database error` → Check database connection

### Step 6: Verify Database

```bash
bun run scripts/check-abtestevents.ts
```

Should show new events after visiting product page.

## Quick Fixes

### Fix 1: Enable Debug Mode
1. Visit `/app/connect-pixel`
2. Click "Update Settings"
3. Ensure `debug: "true"`

### Fix 2: Verify Active Test
```bash
bun run scripts/check-abtests.ts
```
Ensure test is `ACTIVE` (not `DRAFT`)

### Fix 3: Check Product ID Format
- Pixel uses: `gid://shopify/Product/123456`
- Test must have: `productId: "gid://shopify/Product/123456"`
- Must match exactly

### Fix 4: Test API Directly
```bash
curl "https://shopify-txl.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/YOUR_PRODUCT_ID"
```

Should return:
```json
{
  "testId": "...",
  "activeCase": "BASE"
}
```

If returns `{ testId: null }` → No active test for this product

## Expected Flow (Working)

```
1. Visit product page
   ↓
2. Console: [A/B Test Pixel] Product viewed
   ↓
3. Network: GET /api/rotation-state?productId=...
   ↓
4. Response: { testId: "...", activeCase: "BASE" }
   ↓
5. Console: [A/B Test Pixel] Tracking impression
   ↓
6. Network: POST /track
   ↓
7. Response: { success: true, eventId: "..." }
   ↓
8. Server log: [Track API] Event tracked successfully
   ↓
9. Database: New IMPRESSION event ✅
```

## Still Not Working?

1. **Run diagnostic**: `bun run scripts/debug-pixel-tracking.ts`
2. **Check browser console** for errors
3. **Check Network tab** for failed requests
4. **Check server logs** for validation errors
5. **Verify test exists** and is ACTIVE
6. **Verify productId** matches exactly
