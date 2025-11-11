# 📊 A/B Test Pixel Configuration Guide

## Why Only 1 Impression?

The pixel uses **session-based deduplication** to prevent counting the same user multiple times:
- Each impression is tracked **once per session per test case** (BASE or TEST)
- Uses `sessionStorage` to remember if impression was already tracked
- This prevents inflating metrics when users refresh the page

### To Get New Impressions:
1. **Clear browser storage** (DevTools → Application → Clear Storage)
2. **Open incognito/private window** (new session)
3. **Use different browser**
4. **Wait for rotation** (impression tracked again if case changes)

## 🔧 Pixel Configuration in Shopify Admin

### Step 1: Access Customer Events
1. Go to Shopify Admin
2. Navigate to: **Settings → Customer events**
3. Look for **"ab-test-pixel"** in the list

### Step 2: Configure the Pixel

Click on the pixel and configure these settings:

| Setting | Value | Description |
|---------|-------|-------------|
| **App URL** | `https://shopify.dreamshot.io` | Your app backend URL (NO trailing slash) |
| **Enable A/B Testing** | `true` | Must be "true" to enable tracking |
| **Debug Mode** | `true` | Shows console logs for debugging |

### Step 3: Connect/Enable the Pixel
- Status should show: **Connected** ✅
- If disconnected, click **Connect**

## 🐛 Debug Checklist

### 1. Open Browser DevTools Console
Press F12 and go to Console tab before visiting product page

### 2. Expected Console Logs
When working correctly, you should see:
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed {productId: "...", variantId: "..."}
[A/B Test Pixel] Fetching test state from https://shopify.dreamshot.io/api/rotation-state?productId=...
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
[A/B Test Pixel] Storing test state
[A/B Test Pixel] Checking impression tracking
[A/B Test Pixel] Tracking impression for test ... case BASE
[A/B Test Pixel] Track success
```

### 3. Common Issues

#### ❌ No Console Logs
- Pixel not connected in Shopify Admin
- Debug mode not set to "true"
- Wrong page (must be product page)

#### ❌ "No app_url configured"
- App URL setting is missing or empty
- Fix: Add `https://shopify.dreamshot.io` in pixel settings

#### ❌ CORS/Network Errors
- Check Network tab for failed requests
- Verify app_url doesn't have trailing slash
- Ensure backend is running

#### ❌ "Impression already tracked"
- Normal behavior - prevents duplicate counting
- Clear sessionStorage or use new session

## 🧪 Testing Different Scenarios

### Test Both Cases (BASE and TEST)
1. Clear browser storage
2. Visit product page → BASE impression tracked
3. Wait for rotation or manually trigger it
4. Clear storage again
5. Visit product page → TEST impression tracked

### Test Add to Cart
With pixel working, add product to cart:
- Should track ADD_TO_CART event
- Check monitor for new events

### Test Purchase Flow
Complete a test purchase:
- Should track PURCHASE event
- Clears session state after purchase

## 📝 Verification Commands

```bash
# Monitor events in real-time
bun run scripts/monitor-events.ts

# Check current event counts
bun run scripts/check-abtestevents.ts

# View test statistics
bun run scripts/check-abtests.ts
```

## 🎯 Success Indicators

✅ Console shows `[A/B Test Pixel]` logs
✅ Monitor shows new IMPRESSION events
✅ Different sessions create new impressions
✅ Statistics update in dashboard
✅ Both BASE and TEST cases get tracked

## ⚠️ Important Notes

1. **One impression per session per case** - This is intentional
2. **Impressions reset on rotation** - When case changes, new impression can be tracked
3. **Purchase clears session** - After purchase, new session starts
4. **Debug logs are verbose** - Disable debug mode in production
