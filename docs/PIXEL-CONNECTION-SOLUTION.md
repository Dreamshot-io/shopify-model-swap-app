# Web Pixel Connection Solution

## The Problem
The web pixel shows as "dreamshot-model-swap (Disconnected)" in Shopify Admin, but clicking on it doesn't provide a connection toggle - it just redirects to app pages.

## The Solution: webPixelCreate Mutation

Based on official Shopify documentation and community insights, we can programmatically connect the pixel using the `webPixelCreate` GraphQL mutation.

## Implementation

### Option 1: Automatic Connection (RECOMMENDED)
**Already implemented in: `/app/routes/app._index.tsx`**

The pixel will automatically attempt to connect when the app loads. This follows the community best practice and requires no user action.

### Option 2: Manual Connection Page
**Visit:** https://abtest.dreamshot.io/app/connect-pixel

This page provides:
- Visual status of pixel connection
- "Connect Pixel" button to manually trigger connection
- "Update Settings" to modify existing pixel
- Debug information

## How It Works

### webPixelCreate vs webPixelUpdate

| Feature | webPixelCreate | webPixelUpdate |
|---------|----------------|----------------|
| **Purpose** | Creates and activates pixel | Updates existing pixel settings |
| **When to use** | Initial connection | Modifying settings |
| **Effect on "Disconnected"** | ✅ Fixes it | ❌ Requires existing pixel |
| **Required params** | settings object | pixel ID + settings |

### The Key Insight

From Shopify docs:
> "webPixelCreate activates a web pixel extension by creating a web pixel record on the store"

This is why it changes the status from "Disconnected" to connected - it creates the necessary database record that Shopify's UI checks for.

## Verification Steps

1. **Check connection status:**
   ```bash
   # Visit the connect page
   open https://abtest.dreamshot.io/app/connect-pixel
   ```

2. **Monitor events:**
   ```bash
   bun run scripts/monitor-events.ts
   ```

3. **Check in Shopify Admin:**
   - Go to Settings → Customer Events
   - Look for "dreamshot-model-swap"
   - Status should now show as connected (no "Disconnected" label)

4. **Test on storefront:**
   - Visit: https://genlabs-dev-store.myshopify.com/products/
   - Open DevTools Console (F12)
   - Look for `[A/B Test Pixel]` logs

## Script Tags vs Web Pixels Comparison

### Why Script Tags Work But Pixel UI Doesn't

| Aspect | Script Tags | Web Pixels |
|--------|-------------|------------|
| **API Control** | Full (create/delete) | Partial (deploy only) |
| **Activation** | Automatic via API | Manual UI step required |
| **Shopify UI** | Not needed | Broken in your case |
| **Security Model** | Direct injection | Sandboxed environment |
| **User Consent** | Permission only | Permission + manual connect |

### Technical Explanation

**Script Tags (Old API):**
- Single permission: `write_script_tags`
- GraphQL mutation immediately activates script
- No additional UI interaction needed

**Web Pixels (New API):**
- Permission: `write_pixels`
- CLI deploys extension files
- Requires `webPixelCreate` mutation OR manual UI toggle
- Shopify designed this two-step process for merchant control

## Current Status

✅ **Web Pixel**: Now connectable via GraphQL mutation
✅ **Script Tags**: Already working as backup solution
✅ **Backend API**: Fully functional
✅ **Database**: Ready for events
✅ **Monitor**: Running and waiting

## Next Steps

1. The app will auto-connect the pixel on next load
2. Or manually connect at: /app/connect-pixel
3. Verify events are being tracked
4. Choose between Web Pixel or Script Tags for production

## Fallback Options

If pixel connection still fails:
1. **Script Tags** (already implemented): /app/script-tags
2. **Theme Integration**: Manual script in theme.liquid
3. **Cart Webhooks**: Server-side tracking only

## Code References

- Auto-connect: `app/routes/app._index.tsx:20-40`
- Manual connect: `app/routes/app.connect-pixel.tsx`
- Script Tags: `app/routes/app.script-tags.tsx`
- Tracking script: `app/routes/api.tracking-script[.js].ts`
