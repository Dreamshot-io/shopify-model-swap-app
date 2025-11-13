# Impression Deduplication Fix

## Problem Found

The server-side deduplication was checking for duplicates by:
- `testId`
- `sessionId`
- `eventType`
- `productId`

But **NOT** checking `activeCase` (BASE/TEST).

This meant:
- If impression for BASE exists → Rejects impression for TEST ❌
- Should allow: 1 impression per case per session ✅

## Fix Applied

Updated duplicate check to include `activeCase`:

```typescript
const duplicateEvent = await db.aBTestEvent.findFirst({
  where: {
    testId,
    sessionId: normalizedSessionId,
    eventType,
    productId,
    activeCase, // ← Now includes activeCase!
  },
});
```

## Expected Behavior Now

✅ **First visit (BASE)** → Impression tracked
✅ **Second visit same case (BASE)** → Duplicate, skipped
✅ **Case rotates to TEST** → New impression tracked (different case)
✅ **Second visit TEST** → Duplicate, skipped
✅ **Case rotates back to BASE** → New impression tracked (different case)

## Why This Matters

- **Accurate A/B test metrics** - Each case tracked separately
- **Case rotation support** - Can track impressions when case changes
- **Proper deduplication** - Still prevents true duplicates (same case)

## Testing

1. **Visit product page** → Should track BASE impression ✅
2. **Refresh page** → Should skip (duplicate BASE) ⏭️
3. **Rotate test to TEST** → Should track TEST impression ✅
4. **Refresh page** → Should skip (duplicate TEST) ⏭️
