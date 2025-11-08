# Alternative Event Tracking Methods

Since the web pixel can't be connected, here are working alternatives:

## 1. Script Tags API (Recommended) ✅

**Status: Ready to use!**

Visit: https://shopify-txl.dreamshot.io/app/script-tags

Click "Install Tracking Script" and it will automatically track:
- Product views (impressions)
- Add to cart events
- Purchases

## 2. Direct Theme Installation

Add this to your theme's `theme.liquid` file before `</body>`:

```html
<script>
(function() {
  // Only run on product pages
  if (!window.location.pathname.includes('/products/')) return;

  const APP_URL = 'https://shopify-txl.dreamshot.io';

  // Get product ID
  const productId = '{{ product.id | prepend: "gid://shopify/Product/" }}';

  // Track impression
  fetch(APP_URL + '/api/rotation-state?productId=' + productId)
    .then(r => r.json())
    .then(data => {
      if (data.testId) {
        // Track impression
        fetch(APP_URL + '/track', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            testId: data.testId,
            sessionId: 'session_' + Date.now(),
            eventType: 'IMPRESSION',
            activeCase: data.activeCase,
            productId: productId
          })
        });
      }
    });

  // Track add to cart
  document.addEventListener('submit', function(e) {
    if (e.target.action && e.target.action.includes('/cart/add')) {
      // Track ATC event
      const testState = JSON.parse(sessionStorage.getItem('ab_test_active') || '{}');
      if (testState.testId) {
        fetch(APP_URL + '/track', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            testId: testState.testId,
            sessionId: 'session_' + Date.now(),
            eventType: 'ADD_TO_CART',
            activeCase: testState.activeCase,
            productId: productId
          })
        });
      }
    }
  });
})();
</script>
```

## 3. Cart Webhooks (Server-side)

Use Shopify webhooks for cart events:
- `carts/create` - New cart created
- `carts/update` - Items added/removed
- `orders/create` - Purchase completed

## 4. App Bridge (From Admin)

If tracking from within the admin app:

```javascript
import { useAppBridge } from '@shopify/app-bridge-react';

const app = useAppBridge();

// Subscribe to cart events
app.subscribe('CART_UPDATE', (data) => {
  // Track event
});
```

## Current Status

✅ **Backend API**: Working perfectly
✅ **Tracking endpoints**: Ready
✅ **Database**: Accepting events
✅ **Statistics**: Calculating correctly
❌ **Web pixel**: Can't be connected (Shopify issue)
✅ **Script Tags**: Alternative ready to use!

## Quick Test

After installing via Script Tags:
1. Open DevTools Console (F12)
2. Visit: https://genlabs-dev-store.myshopify.com/products/
3. Look for: `[A/B Test Tracker]` logs
4. Check monitor for events

## Monitor

The monitor is still running and will show events:
```bash
bun run scripts/monitor-events.ts
```