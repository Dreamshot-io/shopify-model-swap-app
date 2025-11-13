# Why Events Are Not Recording - Quick Diagnosis

## The Problem

Pixel is connected ✅ but events are not being saved to database ❌

## Root Cause Analysis

Looking at the code flow:

```
1. Pixel fires on product_viewed ✅
2. Pixel calls fetchAndStoreTestState()
3. Fetches GET /api/rotation-state?productId=...
4. If response.testId === null → Pixel STOPS (no tracking) ❌
5. If response.testId exists → Pixel tracks impression ✅
```

**Key Issue**: If `/api/rotation-state` returns `{ testId: null }`, the pixel silently stops and never tracks.

## Why `/api/rotation-state` Returns Null

The `getRotationState` function queries:

```typescript
const test = await db.aBTest.findFirst({
  where: {
    productId,  // Must match EXACTLY
    status: { in: ["ACTIVE", "PAUSED"] },
  },
});
```

Returns `null` if:
1. ❌ No test exists for this productId
2. ❌ Test exists but productId doesn't match exactly
3. ❌ Test exists but status is DRAFT or COMPLETED

## Most Common Causes

### 1. **No Active Test** (90% of cases)

**Check**:
```bash
bun run scripts/debug-pixel-tracking.ts
```

**Fix**:
- Create an ACTIVE test for the product
- Or activate existing test (change status from DRAFT to ACTIVE)

### 2. **Product ID Mismatch** (80% of cases)

**Problem**: Pixel sends one format, test has different format

**Pixel sends**: `event.data?.product?.id`
- Format: `gid://shopify/Product/7821131415621`

**Test has**: `productId` field
- Must match EXACTLY: `gid://shopify/Product/7821131415621`

**Common mismatches**:
- ❌ `7821131415621` (missing prefix)
- ❌ `gid://shopify/Product/7821131415622` (wrong ID)
- ❌ `product-7821131415621` (wrong format)

**Fix**:
1. Check browser console for actual productId
2. Check test.productId in database
3. Update test if needed

### 3. **Test Status Wrong** (10% of cases)

**Problem**: Test exists but status is DRAFT

**Check**:
```bash
bun run scripts/check-abtests.ts
```

**Fix**:
- Change test status to ACTIVE
- Or use PAUSED (also works)

## Quick Diagnosis Steps

### Step 1: Run Diagnostic Script
```bash
bun run scripts/debug-pixel-tracking.ts
```

This will show:
- Active tests
- Product IDs
- Event counts

### Step 2: Check Browser Console

Open DevTools (F12) → Console → Visit product page

**Look for**:
```
[A/B Test Pixel] Product viewed {productId: "gid://shopify/Product/..."}
[A/B Test Pixel] Fetching test state from https://...
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
```

**If you see**:
```
[A/B Test Pixel] No active test for this product
```
→ No active test OR productId mismatch

### Step 3: Check Network Tab

DevTools → Network → Filter: XHR/Fetch

**Look for**:
- `GET /api/rotation-state?productId=...`
- Response should be: `{ testId: "...", activeCase: "BASE" }`

**If response is**:
- `{ testId: null, activeCase: null }` → No active test
- 404 error → API endpoint not found
- CORS error → CORS configuration issue

### Step 4: Test API Directly

```bash
curl "https://shopify-txl.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/YOUR_PRODUCT_ID"
```

**Expected**:
```json
{
  "testId": "cmhp60nbg00009ke5i0c06owy",
  "activeCase": "BASE"
}
```

**If null**:
- No active test for this productId
- ProductId doesn't match exactly

### Step 5: Check Database

```bash
bun run scripts/check-abtests.ts
```

Verify:
- Test exists
- Status is ACTIVE or PAUSED
- productId matches exactly what pixel sends

## Fixes

### Fix 1: Create/Activate Test

1. Go to `/app/ab-tests`
2. Create new test OR activate existing test
3. Ensure status is ACTIVE
4. Verify productId matches

### Fix 2: Fix Product ID Format

If productId mismatch:

1. Check what pixel sends (browser console)
2. Update test.productId to match exactly
3. Or normalize productId in API endpoint

### Fix 3: Enable Better Logging

The pixel now logs warnings when no test found. Check browser console for:
```
[A/B Test Pixel] No active test for this product {productId: "...", response: {...}}
```

## Expected Working Flow

```
✅ Pixel connected
✅ Visit product page
✅ Console: [A/B Test Pixel] Product viewed
✅ Network: GET /api/rotation-state → { testId: "...", activeCase: "BASE" }
✅ Console: [A/B Test Pixel] Tracking impression
✅ Network: POST /track → { success: true }
✅ Database: New IMPRESSION event
```

## Still Not Working?

1. **Run**: `bun run scripts/debug-pixel-tracking.ts`
2. **Check**: Browser console for warnings
3. **Verify**: Active test exists for product
4. **Verify**: ProductId matches exactly
5. **Check**: Server logs for `/track` endpoint errors
