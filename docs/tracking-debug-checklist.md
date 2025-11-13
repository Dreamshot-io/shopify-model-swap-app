# Tracking Debug Checklist

## Current Status
- ✅ Pixel connected
- ✅ ProductId extracted correctly
- ✅ No window/document errors
- ❌ Events not recording in database

## Debug Steps

### 1. Check Browser Console
After visiting product page, look for:

**Expected logs:**
```
[A/B Test Pixel] Product viewed - extracted productId: 7821131415621
[A/B Test Pixel] Normalized productId to GID format gid://shopify/Product/7821131415621
[A/B Test Pixel] Fetching test state from https://shopify-txl.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/7821131415621
[A/B Test Pixel] API Response: { url: "...", status: 200, productId: "...", result: {...} }
```

**If you see:**
```
⚠️ No active test found for product
```
→ Check if test exists and productId matches

**If you see:**
```
✅ Test found: { testId: "...", activeCase: "BASE" }
📊 Tracking IMPRESSION: { testId: "...", activeCase: "BASE", productId: "..." }
✅ Track API Success: { eventType: "IMPRESSION", ... }
```
→ Events should be recording!

### 2. Check Network Tab
DevTools → Network → Filter: XHR/Fetch

**Look for:**
- `GET /api/rotation-state?productId=...` → Should return 200 with `{ testId: "...", activeCase: "BASE" }`
- `POST /track` → Should return 200 with `{ success: true, eventId: "..." }`

**If 404:**
→ API endpoint not found (check URL)

**If 200 but `{ testId: null }`:**
→ No active test for this productId

**If 400/500:**
→ Check response body for error message

### 3. Check Server Logs
Look for:
```
[rotation-state] Searching for test with productId: gid://shopify/Product/7821131415621
[rotation-state] ✅ Test found: { testId: "...", activeCase: "BASE" }
```

Or:
```
[rotation-state] ❌ No test found for productId: gid://shopify/Product/7821131415621
```

### 4. Verify Test Exists
Run:
```bash
bun run scripts/diagnose-pixel-tracking.ts
```

**Check:**
- Test exists and is ACTIVE/PAUSED
- productId matches exactly (GID format)
- If test has numeric ID but pixel sends GID → API now tries both formats

### 5. Common Issues

#### Issue 1: ProductId Mismatch
**Symptom**: API returns `{ testId: null }`

**Check:**
- Pixel sends: `gid://shopify/Product/7821131415621`
- Test has: `gid://shopify/Product/7821131415621` (must match exactly)

**Fix:**
- Update test.productId to match pixel format
- Or API now tries both formats automatically

#### Issue 2: Test Status Wrong
**Symptom**: Test exists but API returns null

**Check:**
- Test status must be ACTIVE or PAUSED
- DRAFT tests won't be found

**Fix:**
- Change test status to ACTIVE

#### Issue 3: API Not Called
**Symptom**: No network requests in DevTools

**Check:**
- Pixel connected in Shopify Admin
- `app_url` setting configured
- No CORS errors

**Fix:**
- Verify pixel settings
- Check console for errors

#### Issue 4: Track API Fails
**Symptom**: Rotation API works but Track API fails

**Check:**
- Network tab shows POST /track error
- Server logs show error

**Fix:**
- Check server logs for error details
- Verify CORS headers
- Check request payload format

## Next Steps

1. **Visit product page** with DevTools open
2. **Share console logs** (especially API Response)
3. **Share Network tab** (rotation-state and track requests)
4. **Share server logs** (rotation-state logs)

This will help identify exactly where it's failing!
