# Impression Deduplication Explained

## How It Works

Impressions are **deduplicated** - only **1 impression per session per test case** (BASE or TEST).

### Expected Behavior

✅ **First visit** → Impression tracked
✅ **Second visit (same session)** → Impression NOT tracked (deduplicated)
✅ **New session** → Impression tracked again
✅ **Case changes** (BASE → TEST) → New impression tracked

## Why Deduplication?

- **Accurate unique visitor counts** - One person = one impression
- **Prevents metric inflation** - Refreshing page doesn't create duplicates
- **Industry standard** - Matches how analytics tools work

## How to Test

### Test 1: First Visit (Should Track)
1. Clear browser storage (DevTools → Application → Clear Storage)
2. Visit product page
3. ✅ Should see: `[A/B Test Pixel] 📊 Tracking IMPRESSION`
4. ✅ Check database: 1 new IMPRESSION event

### Test 2: Second Visit Same Session (Should NOT Track)
1. Refresh product page (same browser session)
2. ✅ Should see: `[A/B Test Pixel] ⏭️ Skipping duplicate impression`
3. ✅ Check database: Still 1 IMPRESSION event (no new one)

### Test 3: New Session (Should Track Again)
1. Open incognito/private window
2. Visit product page
3. ✅ Should see: `[A/B Test Pixel] 📊 Tracking IMPRESSION`
4. ✅ Check database: 2 IMPRESSION events total

## Deduplication Logic

### Client-Side (Pixel)
```typescript
const alreadyTracked = await browser.sessionStorage.getItem(syncKey);
if (alreadyTracked === state.activeCase) {
  return; // Skip duplicate
}
// Track impression
await browser.sessionStorage.setItem(syncKey, state.activeCase);
```

### Server-Side (API)
```typescript
const duplicateEvent = await db.aBTestEvent.findFirst({
  where: {
    testId,
    sessionId,
    eventType: 'IMPRESSION',
    productId,
  },
});
if (duplicateEvent) {
  return { success: true, message: 'Event already tracked' };
}
```

## Session Storage Keys

- `ab_test_impression_{testId}` - Stores the case that was tracked (BASE or TEST)
- Example: `ab_test_impression_cmhxr8jri000e9k88ke4kubm5` = `"BASE"`

## When New Impressions Are Tracked

1. ✅ **New browser session** (incognito, clear storage)
2. ✅ **Case rotation** (BASE → TEST or TEST → BASE)
3. ✅ **After purchase** (session cleared)
4. ✅ **Different product** (different test)

## Debugging

If impressions aren't tracking:

1. **Check console logs**:
   ```
   [A/B Test Pixel] Checking impression tracking { alreadyTracked: null, currentCase: "BASE" }
   ```
   - If `alreadyTracked: null` → Should track ✅
   - If `alreadyTracked: "BASE"` → Will skip (duplicate) ⏭️

2. **Check sessionStorage**:
   - DevTools → Application → Session Storage
   - Look for `ab_test_impression_{testId}`
   - Value should be "BASE" or "TEST"

3. **Check database**:
   ```bash
   bun run scripts/check-abtestevents.ts
   ```
   - Should see IMPRESSION events
   - Same sessionId = only 1 per session

## Summary

**This is working correctly!** One impression per session is the intended behavior. To see multiple impressions:
- Use different browsers/sessions
- Clear storage between visits
- Wait for case rotation
