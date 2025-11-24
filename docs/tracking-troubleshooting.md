# Why Tracking Isn't Working - Diagnostic Guide

## Quick Check: Is Pixel Active?

**The pixel must be:**
1. ✅ Deployed (extension exists)
2. ✅ Connected (activated in Shopify)
3. ✅ Configured (has `app_url` setting)

## Step-by-Step Diagnosis

### Step 1: Check Browser Console

**Open DevTools (F12) → Console tab → Visit product page**

#### ✅ If you see logs like:
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed {productId: "..."}
[A/B Test Pixel] Fetching test state...
```
→ Pixel is running, check Step 2

#### ❌ If you see NO logs:
→ Pixel not connected or not deployed

**Fix:**
1. Check if pixel is deployed:
   ```bash
   shopify app info
   ```
   Look for `ab-test-pixel` extension

2. Connect pixel:
   - Visit: `/app/connect-pixel` in your app
   - Click "Connect Pixel" button
   - OR: Pixel auto-connects on app load (`app/routes/app._index.tsx`)

3. Verify in Shopify Admin:
   - Settings → Customer Events
   - Find "ab-test-pixel" or "dreamshot-model-swap"
   - Status should be "Connected" (not "Disconnected")

### Step 2: Check Pixel Configuration

**If logs appear but tracking fails, check settings:**

#### Missing `app_url` Warning:
```
[A/B Test Pixel] Warning: app_url setting is missing or empty
```

**Fix:**
1. Visit: `/app/connect-pixel`
2. Click "Update Settings"
3. Set `app_url` to: `https://abtest.dreamshot.io` (or your app URL)
4. Set `debug` to: `true` (for development)

**OR manually via GraphQL:**
```graphql
mutation {
  webPixelUpdate(webPixel: {
    id: "gid://shopify/WebPixel/..."
    settings: {
      app_url: "https://abtest.dreamshot.io"
      debug: "true"
      enabled: "true"
    }
  }) {
    webPixel { id settings }
    userErrors { field message }
  }
}
```

### Step 3: Check Network Requests

**DevTools → Network tab → Filter: XHR/Fetch**

#### ✅ Should see requests to:
- `GET /api/rotation-state?productId=...`
- `POST /track`

#### ❌ If requests fail:

**CORS errors:**
- Check `/app/routes/api.rotation-state.ts` has CORS headers
- Check `/app/routes/track.tsx` has CORS headers

**404 errors:**
- Verify `app_url` is correct (no trailing slash)
- Check endpoints exist: `/api/rotation-state` and `/track`

**500 errors:**
- Check server logs
- Verify database connection
- Check for test with matching `productId`

### Step 4: Check Test State

**The pixel needs an ACTIVE test for the product:**

1. Verify test exists:
   ```bash
   bun run scripts/check-abtests.ts
   ```

2. Check test status:
   - Must be `ACTIVE` or `PAUSED` (not `DRAFT`)

3. Verify productId matches:
   - Pixel uses: `event.data?.product?.id` (Shopify GID format)
   - Test has: `productId` field
   - Must match exactly (including `gid://shopify/Product/` prefix)

### Step 5: Check Database

**After visiting product page, verify events:**

```bash
bun run scripts/check-abtestevents.ts
```

**Should see:**
- `IMPRESSION` events with `testId`, `sessionId`, `activeCase`

**If no events:**
- Check `/app/routes/track.tsx` logs
- Verify test exists and is active
- Check for validation errors (missing fields)

## Common Issues

### Issue 1: Pixel Not Connected

**Symptoms:**
- No console logs
- Pixel shows "Disconnected" in Shopify Admin

**Fix:**
```bash
# Visit connect page
open https://abtest.dreamshot.io/app/connect-pixel

# Or check auto-connect
# Should run on app load (app/routes/app._index.tsx:10-44)
```

### Issue 2: Missing `app_url` Setting

**Symptoms:**
- Console warning: "app_url setting is missing"
- No API calls made

**Fix:**
- Update pixel settings with `app_url`
- Must be absolute URL (no trailing slash)

### Issue 3: Wrong Product ID Format

**Symptoms:**
- Pixel logs show productId
- But `/api/rotation-state` returns `null`

**Check:**
- Pixel sends: `gid://shopify/Product/123456`
- Test has: `productId: "gid://shopify/Product/123456"`
- Must match exactly

### Issue 4: Test Not Active

**Symptoms:**
- API calls succeed
- But no impression tracked

**Check:**
- Test status must be `ACTIVE` or `PAUSED`
- Not `DRAFT` or `COMPLETED`

### Issue 5: Development vs Production

**In development:**
- Pixel runs on storefront (e.g., `genlabs-dev-store.myshopify.com`)
- Must call app backend (e.g., `abtest.dreamshot.io`)
- Requires `app_url` setting

**Check:**
- Is `app_url` pointing to correct environment?
- Dev: `http://localhost:3000` (if using tunnel)
- Prod: `https://abtest.dreamshot.io`

## Quick Test Script

Run this to check everything:

```bash
# 1. Check pixel deployment
shopify app info

# 2. Check pixel connection
# Visit: /app/connect-pixel

# 3. Check active tests
bun run scripts/check-abtests.ts

# 4. Visit product page with DevTools open
# Look for [A/B Test Pixel] logs

# 5. Check events
bun run scripts/check-abtestevents.ts
```

## Expected Flow (Working)

```
1. Customer visits product page
   ↓
2. Shopify fires product_viewed event
   ↓
3. Pixel receives event (console: "[A/B Test Pixel] Product viewed")
   ↓
4. Pixel fetches test state: GET /api/rotation-state?productId=...
   ↓
5. API returns: { testId: "...", activeCase: "BASE" }
   ↓
6. Pixel stores state in sessionStorage
   ↓
7. Pixel tracks impression: POST /track
   ↓
8. Server creates ABTestEvent record
   ↓
9. Database has new IMPRESSION event ✅
```

## Still Not Working?

1. **Check server logs** for errors
2. **Verify CORS** headers are set
3. **Test API directly:**
   ```bash
   curl "https://abtest.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/123"
   ```
4. **Check pixel settings** in Shopify Admin
5. **Clear browser cache** and try incognito window
