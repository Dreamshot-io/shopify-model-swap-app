# A/B Test Event Tracking Diagnosis

## Summary

**Zero ABTestEvent records exist in the database**, despite having 1 active A/B test that has been rotating successfully.

## Database State

### ABTestEvent Table
- **Total records**: 0
- **IMPRESSION events**: 0
- **ADD_TO_CART events**: 0
- **PURCHASE events**: 0

### Active Test Details
- **Name**: BC4
- **ID**: cmhp60nbg00009ke5i0c06owy
- **Shop**: genlabs-dev-store.myshopify.com
- **Product**: gid://shopify/Product/7806848499781
- **Status**: ACTIVE
- **Current Case**: BASE
- **Events Tracked**: 0
- **Rotation Events**: 4 (all successful)
- **Audit Logs**: 14

## Root Cause Analysis

The tracking infrastructure is implemented but **NOT operational**. Here's why:

### 1. Web Pixel Extension Not Deployed/Configured

**Evidence:**
- Extension code exists at `/extensions/ab-test-pixel/src/index.ts`
- Extension is configured in `shopify.extension.toml`
- BUT: No evidence of deployment to the store

**The pixel code should:**
1. Listen for `product_viewed` events
2. Fetch test state from `/api/rotation-state`
3. Track IMPRESSION to `/track` endpoint
4. Store session state to prevent duplicate tracking

**Missing configuration:**
- `app_url` setting (required for API calls)
- `debug` mode (needed for troubleshooting)
- Extension deployment to store

### 2. Tracking Flow Breakdown

Expected flow:
```
Customer views product
    ↓
Shopify fires product_viewed event
    ↓
ab-test-pixel extension receives event
    ↓
Pixel fetches: GET /api/rotation-state?productId=XXX
    ↓
Pixel stores test state in sessionStorage
    ↓
Pixel tracks: POST /track (eventType: IMPRESSION)
    ↓
Server validates and creates ABTestEvent record
```

**Actual flow:**
```
Customer views product
    ↓
(pixel not active or not configured)
    ↓
❌ NO TRACKING OCCURS
```

### 3. API Endpoints Status

#### ✅ `/api/rotation-state` - EXISTS
Location: `/app/routes/api.rotation-state.ts`

#### ✅ `/track` - EXISTS  
Location: `/app/routes/track.tsx`
- Validates required fields
- Creates ABTestEvent records
- Handles CORS for public access
- Includes duplicate prevention for IMPRESSION events

Both endpoints are functional and ready to receive requests.

### 4. Extension Configuration Requirements

From `shopify.extension.toml`, the pixel needs:

```toml
[settings.fields.app_url]
name = "App URL"
description = "The URL of your Shopify app backend"
type = "single_line_text_field"

[settings.fields.debug]
name = "Debug Mode"
description = "Enable console logging for debugging"
type = "single_line_text_field"
```

These settings must be configured in Shopify Admin.

## Verification Steps

### To check if pixel is deployed:

1. Navigate to Shopify Admin
2. Go to **Settings** > **Customer events**
3. Look for **"ab-test-pixel"** extension
4. Check if it's installed and enabled

### To test pixel functionality:

1. Enable debug mode in pixel settings
2. Set app_url to your app's public URL
3. Visit the storefront product page
4. Open browser console (F12)
5. Look for logs starting with `[A/B Test Pixel]`

Expected console output:
```
[A/B Test Pixel] Initialized {APP_URL: "...", ROTATION_API: "..."}
[A/B Test Pixel] Product viewed {productId: "...", variantId: "..."}
[A/B Test Pixel] Fetching test state from ...
[A/B Test Pixel] Test state result {...}
[A/B Test Pixel] Storing test state {...}
[A/B Test Pixel] Tracking impression for test ...
[A/B Test Pixel] Track success {...}
```

### To verify tracking endpoint:

```bash
curl -X POST https://your-app-url/track \
  -H "Content-Type: application/json" \
  -d '{
    "testId": "cmhp60nbg00009ke5i0c06owy",
    "sessionId": "test_session_123",
    "eventType": "IMPRESSION",
    "activeCase": "BASE",
    "productId": "gid://shopify/Product/7806848499781"
  }'
```

Expected response:
```json
{
  "success": true,
  "eventId": "...",
  "activeCase": "BASE",
  "message": "IMPRESSION event tracked successfully"
}
```

## Resolution Checklist

- [ ] Deploy ab-test-pixel extension to Shopify
- [ ] Configure app_url setting in Shopify Admin
- [ ] Enable debug mode for testing
- [ ] Visit product page and verify console logs
- [ ] Check database for IMPRESSION events
- [ ] Test ADD_TO_CART tracking
- [ ] Test PURCHASE tracking (checkout flow)

## Files Reference

### Pixel Implementation
- **Extension source**: `/extensions/ab-test-pixel/src/index.ts`
- **Extension config**: `/extensions/ab-test-pixel/shopify.extension.toml`
- **Built file**: `/extensions/ab-test-pixel/dist/ab-test-pixel.js`

### API Endpoints
- **Rotation state**: `/app/routes/api.rotation-state.ts`
- **Event tracking**: `/app/routes/track.tsx`

### Database Schema
- **ABTestEvent model**: `/prisma/schema.prisma` (lines 88-110)
- **Test model**: `/prisma/schema.prisma` (lines 33-65)

## Testing Scripts

Created diagnostic scripts:
- `/scripts/check-abtestevents.ts` - Query ABTestEvent records
- `/scripts/check-abtests.ts` - Query ABTest records
- `/scripts/check-pixel-deployment.ts` - Deployment status check

Run with:
```bash
bun run scripts/check-abtestevents.ts
bun run scripts/check-abtests.ts
bun run scripts/check-pixel-deployment.ts
```

## Next Steps

1. **Immediate**: Check if pixel extension is deployed
2. **Configure**: Set app_url in Shopify Admin settings
3. **Test**: Enable debug mode and verify console logs
4. **Validate**: Confirm IMPRESSION events appear in database
5. **Monitor**: Track conversion funnel (IMPRESSION → ADD_TO_CART → PURCHASE)

## Related Documentation

- Pixel implementation: `/extensions/ab-test-pixel/src/index.ts`
- Tracking endpoint: `/app/routes/track.tsx`
- Database schema: `/prisma/schema.prisma`
