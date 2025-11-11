# Agent Knowledge Base: A/B Testing System

## System Overview

This is a Shopify app that performs A/B testing on product images by rotating between BASE and TEST image sets to measure conversion impact.

## Core Concepts

### 1. Image Rotation
- **BASE**: Original product images
- **TEST**: Alternative product images
- **Rotation**: Switching between BASE and TEST at scheduled intervals
- **Current Case**: Which variant is currently showing (stored in DB)

### 2. Event Tracking
- **IMPRESSION**: Product page view
- **ADD_TO_CART**: User adds product to cart
- **PURCHASE**: User completes purchase (not yet implemented)

### 3. Statistics
- **CVR**: Conversion Rate (purchases/impressions)
- **ATC**: Add to Cart Rate (add_to_carts/impressions)
- **Lift**: Percentage improvement of TEST over BASE

## Critical Code Paths

### A. Rotation Flow
```
User visits product → /api/rotation-state → Returns current case (BASE/TEST)
Browser shows appropriate images based on response
```

### B. Tracking Flow
```
Page load → Script Tag executes → Fetches rotation state → Tracks impression
User action → Script intercepts → Sends event to /track endpoint
```

### C. Cron Rotation
```
Every 10 min → Vercel calls /api/rotation → Checks tests due
For each test → Get session token → Create admin client → Rotate images
```

## Common Tasks & Solutions

### Task: Fix impression tracking showing 0
```bash
# 1. Check field mapping
grep -n "activeCase\|variant" app/features/ab-testing/utils/statistics.ts

# 2. Install Script Tags
Visit: /app/script-tags → Click "Install"

# 3. Monitor events
bun run scripts/monitor-events.ts
```

### Task: Images not rotating
```bash
# 1. Check rotation state
bun run scripts/test-rotation-state.ts <productId>

# 2. Force rotation
bun run scripts/trigger-rotation-now.ts

# 3. Check logs
curl https://shopify.dreamshot.io/api/rotation-state?productId=<id>
```

### Task: Cron job failing
```bash
# 1. Check session exists
bun run scripts/check-sessions.ts

# 2. Test endpoint
curl -X POST https://shopify.dreamshot.io/api/rotation

# 3. Check error logs
Look for "[Cron Admin] GraphQL request failed" in logs
```

## Key Files to Know

### Core Services
- `/app/services/simple-rotation.server.ts` - Handles all rotation logic
- `/app/services/ab-test-rotation-sync.server.ts` - Sync rotation state

### API Endpoints
- `/app/routes/api.rotation-state.ts` - Get current showing variant
- `/app/routes/api.rotation.ts` - Cron job endpoint
- `/app/routes/track.ts` - Event tracking endpoint

### UI Components
- `/app/features/ab-testing/components/ABTestManager.tsx` - Main UI
- `/app/routes/app.ab-tests.$id.tsx` - Test detail page

### Configuration
- `/vercel.json` - Cron job schedule
- `/shopify.app.toml` - App configuration and scopes

## Database Queries

### Get active tests due for rotation
```sql
SELECT * FROM "ABTest"
WHERE status = 'ACTIVE'
AND "nextRotation" <= NOW();
```

### Get events for a test
```sql
SELECT * FROM "ABTestEvent"
WHERE "testId" = '<test-id>'
ORDER BY "createdAt" DESC;
```

### Get session for shop
```sql
SELECT * FROM "Session"
WHERE shop = '<shop-domain>'
ORDER BY id DESC
LIMIT 1;
```

## Error Patterns & Fixes

### Error: "No valid session found for shop"
**Cause**: Session expired or missing
**Fix**: User needs to reinstall app or login

### Error: "Failed to transfer R2 image to Shopify"
**Cause**: Image upload issue
**Fix**: Check R2 credentials and permissions

### Error: "Unknown field rotationIntervalHours"
**Cause**: Using wrong field name
**Fix**: Use `rotationHours` instead

### Error: "GraphQL request failed"
**Cause**: Invalid access token or API changes
**Fix**: Check token validity and API version

## Testing Checklist

### Before Deployment
- [ ] Test rotation manually via UI button
- [ ] Verify impression tracking works
- [ ] Check cron endpoint responds
- [ ] Confirm statistics calculate correctly

### After Deployment
- [ ] Monitor first cron execution
- [ ] Check events are being recorded
- [ ] Verify images actually change on storefront
- [ ] Confirm no console errors on product pages

## Environment-Specific Notes

### Development
- Uses local database
- Script Tags need reinstall after URL changes
- Browser console shows detailed logs

### Production (Vercel)
- Cron runs every 10 minutes
- Logs available in Vercel dashboard
- Script Tags served from production URL

## Quick Debug Commands

```bash
# View all active tests
bun run scripts/check-abtests.ts | grep ACTIVE

# Check last 10 events
bun run scripts/check-abtestevents.ts | head -20

# Test rotation for specific test
bun run scripts/trigger-rotation-now.ts <testId>

# Monitor events real-time
bun run scripts/monitor-events.ts

# Check cron status
bun run scripts/test-cron-simple.ts
```

## Architecture Decisions

### Why Script Tags over Web Pixels?
- No manual connection required
- Works immediately after installation
- Better browser compatibility
- Easier to debug

### Why session-based deduplication?
- Prevents inflated impression counts
- One impression per session per test
- Aligns with standard analytics practices

### Why direct access token for cron?
- Cron has no cookies/session
- Needs programmatic authentication
- Access token stored in Session table

## Integration Points

### Shopify APIs Used
- GraphQL Admin API (product updates)
- Script Tags API (tracking injection)
- Staged Uploads (image uploads)
- Web Pixels (attempted, not working)

### External Services
- Cloudflare R2 (image storage)
- Vercel (hosting & cron)
- PostgreSQL (database)

## Performance Considerations

- Rotation takes ~10-15 seconds (image uploads)
- Script tag loads asynchronously (no page speed impact)
- Database queries indexed on key fields
- Session storage used for deduplication

## Security Notes

- Access tokens stored encrypted in database
- CORS headers configured for public endpoints
- Authentication temporarily disabled on /api/rotation (TODO: re-enable)
- Script Tags only track necessary data

## Known Limitations

1. Single shop deployment only
2. No purchase event tracking yet
3. Web Pixel can't be connected
4. Manual theme modifications not supported
5. Variant-level testing incomplete

## Future Improvements

1. Multi-shop support
2. Purchase webhook integration
3. Advanced analytics dashboard
4. Variant-specific testing
5. Automated winner selection

---

## Agent Instructions

When working on this system:

1. **Always check existing documentation first** - Most issues are already solved
2. **Use the test scripts** - Don't manually query database
3. **Monitor events when testing** - Run monitor-events.ts in parallel
4. **Check both activeCase and variant fields** - For backward compatibility
5. **Test on actual storefront** - Not just admin panel
6. **Keep auth check disabled for now** - On /api/rotation endpoint
7. **Use Script Tags, not Web Pixel** - For event tracking

## Contact for Issues

- Check `/docs/` folder for detailed guides
- Review test scripts in `/scripts/` for examples
- Consult ABTEST_REQUIREMENTS.md for original specs
- See TODAYS_FEATURES_SUMMARY.md for recent changes

---

*Last Updated: November 8, 2024*
*System Status: Operational with minor limitations*
