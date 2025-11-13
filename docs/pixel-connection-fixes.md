# Pixel Connection Issues - Root Causes & Fixes

Based on research and common Shopify web pixel issues, here are the main causes and solutions:

## 🔴 Critical Issues Found

### 1. **GraphQL Query Issue** ⚠️ FIXED
**Problem**: The `webPixel` (singular) query doesn't work reliably. Should query `webPixels` (plural) and filter.

**Fix Applied**: Updated `/app/routes/app.connect-pixel.tsx` to use `webPixels` query.

### 2. **Customer Privacy Settings** ⚠️ CHECK REQUIRED
**Problem**: Shopify requires cookie consent banner to be active for pixels to work.

**Fix**:
1. Go to Shopify Admin → Settings → Customer Privacy
2. Enable "Show cookie banner"
3. Configure consent settings
4. Test again

**Why**: Without customer consent, Shopify blocks pixel tracking to comply with privacy regulations.

### 3. **Pixel Extension UID Mismatch** ⚠️ CHECK REQUIRED
**Problem**: Pixel might exist but not match our extension UID.

**Check**:
- Extension UID: `ecaa6226-8e43-2519-e06f-e0ea40d84876e26a2ae3`
- Verify in `extensions/ab-test-pixel/shopify.extension.toml`
- Query should filter by `extensionId`

### 4. **Pixel Settings Not Configured** ⚠️ COMMON
**Problem**: Pixel exists but `app_url` setting is missing or incorrect.

**Symptoms**:
- Console warning: "app_url setting is missing or empty"
- No API calls made

**Fix**:
1. Visit `/app/connect-pixel`
2. Click "Update Settings"
3. Verify `app_url` matches `SHOPIFY_APP_URL` env var
4. Set `debug: "true"` for development

### 5. **Pixel Not Actually Connected** ⚠️ MOST COMMON
**Problem**: `webPixelCreate` mutation succeeds but pixel shows as "Disconnected" in Shopify Admin.

**Why**:
- Mutation creates pixel record but doesn't always activate it
- Shopify Admin UI checks different status than GraphQL

**Fix**:
1. After `webPixelCreate`, verify in Shopify Admin:
   - Settings → Customer Events
   - Look for "ab-test-pixel" or "dreamshot-model-swap"
   - Status should be "Connected" (green)
2. If still disconnected:
   - Try `webPixelUpdate` with same settings
   - Or manually connect in Shopify Admin UI

## 🔍 Diagnostic Steps

### Step 1: Run Diagnostic Script
```bash
bun run scripts/diagnose-pixel.ts
```

This will show:
- Recent events in database
- Active tests
- Event statistics
- Recommendations

### Step 2: Check Pixel Connection
Visit: `/app/connect-pixel`

Should show:
- ✅ "Pixel Exists" if connected
- ❌ "No pixel found" if not connected

### Step 3: Check Browser Console
1. Open DevTools (F12) → Console
2. Visit product page with active test
3. Look for:
   - `[A/B Test Pixel] Initialized` ✅
   - `[A/B Test Pixel] Warning: app_url setting is missing` ❌
   - No logs at all ❌ (pixel not connected)

### Step 4: Check Network Requests
DevTools → Network → Filter: XHR/Fetch

Should see:
- `GET /api/rotation-state?productId=...` ✅
- `POST /track` ✅

If missing:
- Check CORS headers
- Verify `app_url` setting
- Check API endpoints exist

### Step 5: Check Customer Privacy
Shopify Admin → Settings → Customer Privacy

Required:
- ✅ Cookie banner enabled
- ✅ Consent settings configured

## 🛠️ Fixes Applied

### 1. Fixed GraphQL Query
Changed from `webPixel` to `webPixels` query with proper filtering.

### 2. Added Diagnostic Script
Created `scripts/diagnose-pixel.ts` for comprehensive diagnostics.

### 3. Enhanced Connect Page
- Shows all pixels found
- Displays settings JSON
- Better error messages

## 📋 Action Items

1. **Run diagnostic**: `bun run scripts/diagnose-pixel.ts`
2. **Check connection**: Visit `/app/connect-pixel`
3. **Enable cookie banner**: Shopify Admin → Customer Privacy
4. **Test on storefront**: Visit product page with DevTools
5. **Monitor events**: `bun run scripts/monitor-events.ts`

## 🔗 References

- [Shopify Web Pixel Docs](https://shopify.dev/docs/apps/marketing/pixels)
- [Customer Privacy Settings](https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels/manage)
- [GraphQL webPixel API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/webPixelCreate)

## ⚠️ Common Mistakes

1. **Forgetting cookie banner** - Most common cause of no tracking
2. **Wrong app_url** - Must match `SHOPIFY_APP_URL` exactly
3. **Debug mode off** - Can't see console logs
4. **Test not active** - Pixel won't track if test is DRAFT
5. **Product ID mismatch** - Must match exactly (GID format)
