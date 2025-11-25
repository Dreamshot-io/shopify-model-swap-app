# Tracking Troubleshooting Guide

Comprehensive guide for diagnosing and fixing A/B test tracking issues.

## Quick Diagnosis

```bash
bun run scripts/debug-pixel-tracking.ts
```

## Most Common Issues

### 1. No Active Test for Product (90% of cases)

**Symptom**: Pixel fires but no events recorded

**Check**:
```bash
bun run scripts/check-abtests.ts
```

**Fix**: Create or activate a test for the product (status must be `ACTIVE` or `PAUSED`, not `DRAFT`)

**Why**: `/api/rotation-state` returns `{ testId: null }` if no active test, and pixel stops tracking.

### 2. Product ID Mismatch (80% of cases)

**Symptom**: Pixel logs productId but API returns null

**Problem**: Pixel sends `gid://shopify/Product/7821131415621` but test has different format

**Common mismatches**:
- `7821131415621` (missing prefix)
- `gid://shopify/Product/7821131415622` (wrong ID)

**Fix**:
1. Check browser console for actual productId pixel sends
2. Update test.productId to match exactly

### 3. Pixel Not Connected

**Symptom**: No `[A/B Test Pixel]` console logs

**Check**: Shopify Admin → Settings → Customer Events

**Fix**: Visit `/app/connect-pixel` and click "Connect Pixel"

### 4. Missing `app_url` Setting

**Symptom**: Warning in console: "app_url setting is missing or empty"

**Fix**: Update pixel settings at `/app/connect-pixel` with correct `app_url`

### 5. Customer Privacy Not Configured

**Symptom**: Pixel connected but no tracking

**Fix**: Shopify Admin → Settings → Customer Privacy → Enable cookie banner

## Step-by-Step Debugging

### Step 1: Verify Pixel Fires

Open DevTools (F12) → Console → Visit product page

**Expected**:
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed {productId: "..."}
```

**If NO logs**: Pixel not connected or debug disabled

### Step 2: Check Test State Fetch

**Expected**:
```
[A/B Test Pixel] Fetching test state from https://...
[A/B Test Pixel] Test state result {testId: "...", activeCase: "BASE"}
```

**If `testId: null`**: No active test or productId mismatch

### Step 3: Check Impression Tracking

**Expected**:
```
[A/B Test Pixel] Tracking impression for test ... case BASE
[A/B Test Pixel] Track success
```

**If missing**: Test state fetch failed

### Step 4: Check Network Requests

DevTools → Network → Filter: XHR/Fetch

**Should see**:
- `GET /api/rotation-state?productId=...` → 200, `{ testId: "...", activeCase: "BASE" }`
- `POST /track` → 200, `{ success: true, eventId: "..." }`

**Common failures**:
- CORS errors → Check `/app/routes/api.rotation-state.ts` headers
- 404 → Check `app_url` setting (no trailing slash)
- 500 → Check server logs, database connection

### Step 5: Check Server Logs

Look for:
- `[Track API] Event tracked successfully` ✅
- `[Track API] Missing required fields` → Check payload
- `[Track API] Test not found` → productId mismatch or test deleted

### Step 6: Verify Database

```bash
bun run scripts/check-abtestevents.ts
```

Should show new events after visiting product page.

## Test API Directly

```bash
curl "https://abtest.dreamshot.io/api/rotation-state?productId=gid://shopify/Product/YOUR_ID"
```

**Expected**:
```json
{ "testId": "...", "activeCase": "BASE" }
```

**If `testId: null`**: No active test for this productId

## Expected Working Flow

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

## Quick Fixes

| Issue | Fix |
|-------|-----|
| No console logs | Visit `/app/connect-pixel`, enable debug mode |
| `testId: null` | Create/activate test, verify productId format |
| Network errors | Check CORS, verify `app_url` setting |
| Server errors | Check logs, verify database connection |

## Diagnostic Scripts

```bash
# Check pixel and test status
bun run scripts/debug-pixel-tracking.ts

# Check active tests
bun run scripts/check-abtests.ts

# Check events in database
bun run scripts/check-abtestevents.ts

# Monitor events in real-time
bun run scripts/monitor-events.ts

# Check pixel deployment
shopify app info
```
