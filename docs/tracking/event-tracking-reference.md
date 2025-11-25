# Event Tracking Reference

Technical reference for A/B test event tracking behavior, deduplication, and session management.

## Event Types

| Event Type | Deduplicated? | Per Session Limit | Purpose |
|------------|--------------|-------------------|---------|
| IMPRESSION | Yes | 1 per case | Unique visitors |
| ADD_TO_CART | No | Unlimited | Engagement tracking |
| PURCHASE | No | Unlimited | Revenue tracking |

## Impression Deduplication

Impressions are deduplicated: **1 impression per session per test case (BASE or TEST)**.

### Expected Behavior

- **First visit** → Impression tracked
- **Same session refresh** → Skipped (deduplicated)
- **New session** → New impression tracked
- **Case rotation (BASE → TEST)** → New impression tracked
- **After purchase** → Session cleared, new impression allowed

### Implementation

**Client-side (Pixel)**:
```typescript
const alreadyTracked = await browser.sessionStorage.getItem(syncKey);
if (alreadyTracked === state.activeCase) {
  return; // Skip duplicate
}
await browser.sessionStorage.setItem(syncKey, state.activeCase);
```

**Server-side (API)**:
```typescript
const duplicateEvent = await db.aBTestEvent.findFirst({
  where: { testId, sessionId, eventType: 'IMPRESSION', productId },
});
if (duplicateEvent) {
  return { success: true, message: 'Event already tracked' };
}
```

### Session Storage Keys

- `ab_test_impression_{testId}` - Stores tracked case (BASE or TEST)
- `ab_test_active` - Current test state
- `ab_test_session` - Persistent session ID

### Console Logs

```
[A/B Test Pixel] Checking impression tracking { alreadyTracked: null, currentCase: "BASE" }
→ Will track (alreadyTracked is null)

[A/B Test Pixel] ⏭️ Skipping duplicate impression
→ Already tracked this case in this session
```

## Add to Cart Events

**NOT deduplicated** - every add to cart is tracked.

- Multiple adds in same session = multiple events
- Tracks quantity for each add
- Measures engagement intensity

## Purchase Events

**NOT deduplicated** - every purchase is tracked.

- Tracks revenue and quantity
- Clears session state after purchase
- Enables new impression tracking post-purchase

## Conversion Rate Calculation

```
Conversion Rate = Add to Carts / Unique Impressions

Example:
- Variant A: 10 impressions, 15 add-to-carts → 150% rate
- Variant B: 10 impressions, 8 add-to-carts → 80% rate
```

Rate can exceed 100% because users can add to cart multiple times.

## Testing Deduplication

### Test 1: First Visit
1. Clear browser storage (DevTools → Application → Clear Storage)
2. Visit product page
3. Should see: `[A/B Test Pixel] 📊 Tracking IMPRESSION`
4. Check database: 1 new IMPRESSION event

### Test 2: Same Session Refresh
1. Refresh product page (same browser session)
2. Should see: `[A/B Test Pixel] ⏭️ Skipping duplicate impression`
3. Check database: Still 1 IMPRESSION event

### Test 3: New Session
1. Open incognito/private window
2. Visit product page
3. Should see: `[A/B Test Pixel] 📊 Tracking IMPRESSION`
4. Check database: 2 IMPRESSION events total

## Debugging

### Check sessionStorage

DevTools → Application → Session Storage

Look for `ab_test_impression_{testId}` with value "BASE" or "TEST"

### Check Database

```bash
bun run scripts/check-abtestevents.ts
```

Verify:
- Same sessionId has only 1 IMPRESSION per case
- Multiple ADD_TO_CART events allowed per session

## Track API Payload

```typescript
{
  testId: string,      // Required
  sessionId: string,   // Required
  eventType: string,   // IMPRESSION | ADD_TO_CART | PURCHASE
  activeCase: string,  // BASE | TEST
  productId: string,   // Shopify GID format
  quantity?: number,   // For ADD_TO_CART, PURCHASE
  revenue?: number,    // For PURCHASE
}
```

## Code References

- Pixel tracking: `extensions/ab-test-pixel/src/index.ts`
- Track API: `app/routes/track.tsx`
- Rotation state: `app/routes/api.rotation-state.ts`
- Statistics utils: `app/features/ab-testing/utils/statistics.ts`
