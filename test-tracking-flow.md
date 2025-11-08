# A/B Test Tracking Debug Checklist

## Extension Deployment Status
- [ ] Extension is built: `/extensions/ab-test-pixel/dist/ab-test-pixel.js` exists ✓
- [ ] App version deployed: dreamshot-model-swap-19 (active) ✓
- [ ] Pixel is enabled in Shopify admin (needs verification)

## API Endpoints Status

### /api/rotation-state
- Purpose: Return test state for a product
- CORS: Enabled (public access)
- Required params: productId
- Optional params: variantId
- Test: `curl http://localhost:3000/api/rotation-state?productId=gid://shopify/Product/XXX`

### /track
- Purpose: Track events (IMPRESSION, ADD_TO_CART, PURCHASE)
- CORS: Enabled (public access)
- Method: POST
- Required fields: testId, sessionId, eventType, productId, activeCase
- Test: `curl -X POST http://localhost:3000/track -H "Content-Type: application/json" -d '{"testId":"...","sessionId":"test","eventType":"IMPRESSION","productId":"...","activeCase":"BASE"}'`

## Pixel Flow

1. **Product View**
   - Event: `product_viewed`
   - Action: Calls `fetchAndStoreTestState()`
   - API Call: GET /api/rotation-state?productId=X
   - Storage: Saves state to sessionStorage
   - Next: Calls `trackImpression()` if test exists

2. **Track Impression**
   - Check: Has this impression been tracked? (sessionStorage key)
   - If not: POST to /track with eventType=IMPRESSION
   - Storage: Mark as tracked in sessionStorage

3. **Add to Cart**
   - Event: `product_added_to_cart`
   - Action: Gets state from sessionStorage
   - API Call: POST /track with eventType=ADD_TO_CART

4. **Purchase**
   - Event: `checkout_completed`
   - Action: Gets state from sessionStorage
   - API Call: POST /track with eventType=PURCHASE for each matching line item
   - Cleanup: Removes state from sessionStorage

## Common Issues

### Issue 1: Pixel Not Loading
- Check: Shopify admin > Settings > Customer events > Web pixels
- Verify: "ab-test-pixel" is listed and enabled
- Solution: Deploy with `shopify app deploy`

### Issue 2: API Returns No Test
- Check: Active test exists in database
- Check: Test productId matches viewed product
- Check: Test status is "ACTIVE"
- Debug: Call /api/debug-events to see active tests

### Issue 3: Events Not Saving
- Check: Network tab for POST to /track
- Check: Response from /track endpoint (should be 200 with success:true)
- Check: Database has ABTestEvent records
- Debug: Look for console errors in browser

### Issue 4: sessionStorage Not Working
- Check: Browser allows sessionStorage
- Check: Third-party cookies enabled (for embedded apps)
- Check: CORS headers are correct

## Debug Commands

```bash
# Check active tests
curl http://localhost:3000/api/debug-events -H "Authorization: Bearer ..."

# Check rotation state for a product
curl "http://localhost:3000/api/rotation-state?productId=gid://shopify/Product/XXX"

# Manually track an impression
curl -X POST http://localhost:3000/track \
  -H "Content-Type: application/json" \
  -d '{
    "testId": "clxxx",
    "sessionId": "test_session",
    "eventType": "IMPRESSION",
    "productId": "gid://shopify/Product/XXX",
    "activeCase": "BASE"
  }'
```

## Next Steps

1. Verify pixel is deployed and enabled in Shopify admin
2. Open a product page in the storefront with an active A/B test
3. Open browser console and check for:
   - Network requests to /api/rotation-state
   - Network requests to /track
   - Any console errors from the pixel
4. Check database for ABTestEvent records
5. If no records, check the /track response for validation errors
