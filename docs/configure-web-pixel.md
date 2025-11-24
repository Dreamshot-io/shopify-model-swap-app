# Configure Web Pixel for A/B Test Tracking

## After Deployment

1. **Go to Shopify Admin** → Settings → Customer events
2. **Find "ab-test-pixel"** in the list of custom pixels
3. **Click "Connect" or "Settings"**
4. **Configure these settings**:
   ```
   app_url: https://abtest.dreamshot.io
   debug: true
   ```

## Testing the Pixel

1. **Open browser DevTools** (F12)
2. **Go to Console tab**
3. **Visit a product page** on your storefront
4. **Look for logs** starting with `[A/B Test Pixel]`

Expected logs:
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed
[A/B Test Pixel] Fetching test state
[A/B Test Pixel] Tracking impression
```

## Verify Database

After visiting a product page, check if events are saved:

```bash
bun run scripts/check-abtestevents.ts
```

You should see:
- IMPRESSION events appearing
- Session IDs being tracked
- activeCase showing BASE or TEST

## Troubleshooting

If no logs appear:
1. Ensure pixel is "Connected" in Shopify Admin
2. Check app_url is correct (must be absolute URL)
3. Verify debug mode is enabled
4. Clear browser cache and reload

If logs appear but no database records:
1. Check for CORS errors in console
2. Verify API endpoints are accessible
3. Check network tab for failed requests
