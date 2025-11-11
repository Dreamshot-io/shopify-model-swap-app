# 📊 A/B Test Event Tracking Behavior

## Event Types & Deduplication Rules

### 🎯 IMPRESSION Events
**Deduplication: YES** ✅
- **1 impression per session per case (BASE/TEST)**
- Refreshing page won't create duplicates
- Stored in `sessionStorage` with key: `ab_test_impression_{testId}`
- New impression only when:
  - New browser session (incognito, clear storage)
  - Test rotates to different case (BASE ↔ TEST)
  - Purchase completes (clears session)

```javascript
// Pixel code checks:
if (alreadyTracked === state.activeCase) {
  return; // Skip duplicate impression
}
```

### 🛒 ADD_TO_CART Events
**Deduplication: NO** ❌
- **Every add to cart is tracked**
- Multiple adds in same session = multiple events
- Tracks quantity for each add
- Perfect for measuring engagement patterns

```javascript
// No deduplication - tracks immediately:
analytics.subscribe('product_added_to_cart', async event => {
  await trackEvent(state, 'ADD_TO_CART', {...});
});
```

### 💳 PURCHASE Events
**Deduplication: NO** ❌
- **Every purchase is tracked**
- Tracks revenue and quantity
- Clears session state after purchase
- Allows new impression tracking after purchase

## Testing Examples

### Test Impressions (Deduplicated)
```bash
# First visit → Tracked ✅
curl -X POST "https://shopify.dreamshot.io/track" \
  -d '{"sessionId": "session1", "eventType": "IMPRESSION", ...}'
# Result: SUCCESS

# Same session refresh → NOT tracked ❌
curl -X POST "https://shopify.dreamshot.io/track" \
  -d '{"sessionId": "session1", "eventType": "IMPRESSION", ...}'
# Result: SUCCESS (but deduplicated on server)
```

### Test Add to Cart (NOT Deduplicated)
```bash
# First add → Tracked ✅
curl -X POST "https://shopify.dreamshot.io/track" \
  -d '{"sessionId": "session1", "eventType": "ADD_TO_CART", ...}'
# Result: SUCCESS

# Second add same session → ALSO tracked ✅
curl -X POST "https://shopify.dreamshot.io/track" \
  -d '{"sessionId": "session1", "eventType": "ADD_TO_CART", ...}'
# Result: SUCCESS (new event created!)
```

## Why This Design?

### Impressions (Deduplicated)
- **Accurate unique visitor counts**
- Prevents inflating view metrics
- Matches industry-standard analytics
- One person = one impression per variant

### Add to Cart (Not Deduplicated)
- **Track engagement intensity**
- Multiple adds show strong interest
- Cart abandonment patterns
- Quantity changes matter

### Purchase (Not Deduplicated)
- **Every transaction counts**
- Revenue tracking accuracy
- Multiple purchases allowed
- Order patterns analysis

## Conversion Rate Calculation

```
Conversion Rate = Add to Carts / Unique Impressions

Example:
- Variant A: 10 impressions, 15 add-to-carts → 150% rate
- Variant B: 10 impressions, 8 add-to-carts → 80% rate
```

Note: Rate can exceed 100% because users can add to cart multiple times!

## Quick Reference

| Event Type | Deduplicated? | Per Session Limit | Why? |
|------------|--------------|-------------------|------|
| IMPRESSION | ✅ Yes | 1 per case | Unique visitors |
| ADD_TO_CART | ❌ No | Unlimited | Track engagement |
| PURCHASE | ❌ No | Unlimited | Every sale counts |

## Session Storage Keys

- `ab_test_active` - Current test state
- `ab_test_session` - Persistent session ID
- `ab_test_impression_{testId}` - Impression tracking per test

## Testing Tips

1. **New Impression**: Clear storage or use incognito
2. **Multiple Adds**: Just keep clicking add to cart!
3. **Monitor Events**: `bun run scripts/monitor-events.ts`
4. **Check Stats**: `bun run scripts/check-abtests.ts`
