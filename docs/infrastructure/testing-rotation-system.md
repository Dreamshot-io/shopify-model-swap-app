# Testing the Server-Driven Rotation System

## Quick Reference

**Force Variant A (CONTROL)**:

- Admin UI: `/app/ab-tests` → Manage → "Activate Control"
- API: `POST /app/api/debug-rotation` with `{"action": "force-switch", "targetVariant": "CONTROL"}`

**Force Variant B (TEST)**:

- Admin UI: `/app/ab-tests` → Manage → "Activate Test"
- API: `POST /app/api/debug-rotation` with `{"action": "force-switch", "targetVariant": "TEST"}`

**Check Current State**:

- Public API: `GET /apps/model-swap/api/rotation-state?productId={id}`
- Debug API: `GET /app/api/debug-rotation?productId={id}` (requires admin auth)

## Finding IDs

### Method 1: Admin UI (Easiest)

**Product ID**:

1. Go to `/app/ab-tests` in Shopify admin
2. Look at the "Product ID" column in the tests table
3. Copy the product ID (format: `gid://shopify/Product/123456789`)

**Slot ID**:

1. Go to `/app/ab-tests` → Click "Manage" on a test
2. Look at the rotation slot card - **Slot ID is displayed** at the top (monospace font)
3. Copy the slot ID (format: `clxxx...` or similar)

**Alternative**: Check browser DevTools Network tab when clicking rotation buttons to see the slotId in the request.

### Method 2: Debug API (Recommended)

**Find Slot ID by Product**:

```bash
GET /app/api/debug-rotation?productId=gid://shopify/Product/123456789
```

Response includes:

```json
{
  "slot": {
    "id": "slot_abc123xyz",  // ← This is your slotId
    "productId": "gid://shopify/Product/123456789",
    ...
  }
}
```

### Method 3: Database Query

If you have database access:

```sql
-- Find slot ID by product
SELECT id, "productId", "shopifyVariantId", "activeVariant", "status"
FROM "RotationSlot"
WHERE shop = 'your-shop.myshopify.com'
  AND "productId" = 'gid://shopify/Product/123456789';

-- List all slots for a shop
SELECT id, "productId", "activeVariant", "lastSwitchAt"
FROM "RotationSlot"
WHERE shop = 'your-shop.myshopify.com'
ORDER BY "createdAt" DESC;
```

### Method 4: From Shopify Product Page

**Product ID from Shopify Admin**:

1. Go to Shopify Admin → Products
2. Click on a product
3. Look at the URL: `https://admin.shopify.com/store/your-shop/products/123456789`
4. The number `123456789` is the product ID
5. Convert to GID format: `gid://shopify/Product/123456789`

**Or use Shopify GraphQL**:

```graphql
query {
	products(first: 10) {
		nodes {
			id # ← This is the productId in GID format
			title
		}
	}
}
```

### Method 5: Browser Console (Storefront)

On a product page, open browser console and run:

```javascript
// Get product ID from page
const productId =
	window.ShopifyAnalytics?.meta?.product?.gid ||
	document.querySelector('meta[property="og:product:id"]')?.content ||
	null;

console.log('Product ID:', productId);
```

## Quick Testing Guide

### 1. Manual Rotation Control (Admin UI)

**Location**: `/app/ab-tests` → Click "Manage" on any test → Rotation Slots modal

**Steps**:

1. Navigate to A/B Tests page in admin
2. Find a test with rotation slots configured
3. Click "Manage" button
4. Use "Activate Control" or "Activate Test" buttons to manually switch

**What it does**:

- Switches `RotationSlot.activeVariant` between CONTROL and TEST
- Updates Shopify product images immediately
- Records history entry

### 2. Check Current Rotation State

**API Endpoint**: `GET /apps/model-swap/api/rotation-state?productId={id}&variantId={optional}`

**Example**:

```bash
curl "https://your-shop.myshopify.com/apps/model-swap/api/rotation-state?productId=gid://shopify/Product/123"
```

**Response**:

```json
{
	"slotId": "slot_abc123",
	"rotationVariant": "CONTROL",
	"abVariant": "A",
	"testId": "test_xyz789",
	"lastSwitchAt": "2024-01-15T10:00:00Z",
	"nextSwitchDueAt": "2024-01-15T10:10:00Z"
}
```

### 3. Force Variant via Rotation Switch

**Admin UI Method** (Recommended):

1. Go to `/app/ab-tests`
2. Click "Manage" on rotation slot
3. Click "Activate Control" (maps to variant A) or "Activate Test" (maps to variant B)

**Debug API Method**:

```bash
# Force switch to CONTROL (Variant A)
curl -X POST https://your-app-url/app/api/debug-rotation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SESSION" \
  -d '{
    "action": "force-switch",
    "slotId": "slot_abc123",
    "targetVariant": "CONTROL"
  }'

# Force switch to TEST (Variant B)
curl -X POST https://your-app-url/app/api/debug-rotation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SESSION" \
  -d '{
    "action": "force-switch",
    "slotId": "slot_abc123",
    "targetVariant": "TEST"
  }'
```

**Check Current State**:

```bash
# Get detailed rotation state
curl "https://your-app-url/app/api/debug-rotation?productId=gid://shopify/Product/123"

# Or via POST
curl -X POST https://your-app-url/app/api/debug-rotation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SESSION" \
  -d '{
    "action": "check-state",
    "productId": "gid://shopify/Product/123"
  }'
```

### 4. Verify Images Changed

**Check Shopify Product Page**:

1. Visit product page in storefront
2. Images should reflect the active rotation variant
3. Refresh to see changes (if cached)

**Check Rotation History**:

```graphql
query {
	rotationSlot(id: "slot_abc123") {
		activeVariant
		lastSwitchAt
		history(first: 10) {
			switchedVariant
			switchedAt
			triggeredBy
		}
	}
}
```

### 5. Test Tracking Attribution

**Simulate Event**:

```bash
POST /apps/model-swap/track
{
  "testId": "test_xyz789",
  "sessionId": "test_session_123",
  "eventType": "IMPRESSION",
  "productId": "gid://shopify/Product/123",
  "occurredAt": "2024-01-15T10:05:00Z"
}
```

**Check Result**:

- Event should be attributed to the variant that was active at `occurredAt` timestamp
- Check `ABTestEvent.variant` field in database

## Testing Scenarios

### Scenario 1: Force CONTROL (Variant A)

1. Switch rotation to CONTROL via admin UI
2. Check `/api/rotation-state` - should return `"rotationVariant": "CONTROL", "abVariant": "A"`
3. Visit product page - should show control images
4. Track an event - should be attributed to variant A

### Scenario 2: Force TEST (Variant B)

1. Switch rotation to TEST via admin UI
2. Check `/api/rotation-state` - should return `"rotationVariant": "TEST", "abVariant": "B"`
3. Visit product page - should show test images
4. Track an event - should be attributed to variant B

### Scenario 3: Automatic Rotation (Cron)

1. Set `nextSwitchDueAt` to past time
2. Call cron endpoint: `POST /api/rotation-switch` (with auth token)
3. Check rotation history - should see new CRON entry
4. Verify images changed in Shopify

## Debug Endpoints

See `app/routes/api.debug-rotation.ts` for additional testing utilities.
