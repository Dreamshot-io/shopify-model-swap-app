# Web Pixel Setup Guide

Complete guide for setting up and connecting the A/B test pixel in Shopify stores.

## Prerequisites

### Required Scopes

In `shopify.app.toml`:
```toml
[access_scopes]
scopes = "...,write_pixels,read_customer_events,..."
```

After adding scopes:
1. Restart `shopify app dev`
2. Accept new permissions in Shopify Admin

## Connection Methods

### Option 1: Auto-Connect (Recommended)

The pixel automatically connects when the app loads via `webPixelCreate` mutation in `/app/routes/app._index.tsx`.

### Option 2: Manual Connect

1. Visit `/app/connect-pixel`
2. Click "Connect Pixel"
3. Wait for success message

### Option 3: Update Settings

If pixel exists but needs configuration:
1. Visit `/app/connect-pixel`
2. Click "Update Settings"
3. Set `app_url` to your app URL (e.g., `https://abtest.dreamshot.io`)
4. Set `debug: "true"` for development

## Verification Steps

### Step 1: Check Shopify Admin

1. Go to **Settings → Customer Events**
2. Find "ab-test-pixel" or "dreamshot-model-swap"
3. Status should show "Connected" (not "Disconnected")

### Step 2: Check Browser Console

1. Open DevTools (F12) → Console
2. Visit product page with active test
3. Look for logs:
```
[A/B Test Pixel] Initialized
[A/B Test Pixel] Product viewed {productId: "..."}
[A/B Test Pixel] Fetching test state...
[A/B Test Pixel] Tracking impression
```

### Step 3: Check Network Requests

DevTools → Network → Filter: XHR/Fetch

Should see:
- `GET /api/rotation-state?productId=...` → 200
- `POST /track` → 200

### Step 4: Verify Database

```bash
bun run scripts/check-abtestevents.ts
```

Should show IMPRESSION events with sessionId and activeCase.

## Required Pixel Settings

```json
{
  "app_url": "https://abtest.dreamshot.io",
  "enabled": "true",
  "debug": "true"
}
```

## Customer Privacy Settings

**Required for pixel to function:**

1. Shopify Admin → Settings → Customer Privacy
2. Enable "Show cookie banner"
3. Configure consent settings

Without consent banner, Shopify blocks pixel tracking for privacy compliance.

## Common Errors

### "PIXEL_ALREADY_EXISTS"
Pixel exists already. Check `/app/connect-pixel` for status and update settings if needed.

### "Missing required scope"
Add `read_customer_events` and `write_pixels` to `shopify.app.toml`, restart dev server.

### "Invalid settings"
Settings must match fields defined in `extensions/ab-test-pixel/shopify.extension.toml`.

### Pixel Shows "Disconnected"
The `webPixelCreate` mutation creates the database record that changes status to connected. Visit `/app/connect-pixel` and click Connect.

## GraphQL Mutations

### Create Pixel
```graphql
mutation webPixelCreate($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    userErrors { code field message }
    webPixel { id settings }
  }
}
```

### Update Pixel Settings
```graphql
mutation webPixelUpdate($webPixel: WebPixelInput!) {
  webPixelUpdate(webPixel: {
    id: "gid://shopify/WebPixel/..."
    settings: {
      app_url: "https://abtest.dreamshot.io"
      debug: "true"
      enabled: "true"
    }
  }) {
    webPixel { id settings }
    userErrors { field message }
  }
}
```

## Script Tags vs Web Pixels

| Aspect | Script Tags | Web Pixels |
|--------|-------------|------------|
| API Control | Full | Partial |
| Activation | Automatic | Manual or via mutation |
| Security | Direct injection | Sandboxed |
| Fallback | See alternative-tracking.md | Preferred method |

## Code References

- Auto-connect: `app/routes/app._index.tsx:20-40`
- Manual connect: `app/routes/app.connect-pixel.tsx`
- Pixel extension: `extensions/ab-test-pixel/src/index.ts`
- Extension config: `extensions/ab-test-pixel/shopify.extension.toml`
