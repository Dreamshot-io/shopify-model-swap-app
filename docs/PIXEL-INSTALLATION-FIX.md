# 🔧 How to Install Your Web Pixel (Like Other Apps Do)

## The Problem
Your pixel IS deployed (version 20, active) but NOT showing in Customer Events settings.

## Why Other Apps Have Their Pixels There
Other apps request the `write_pixels` scope and properly register their pixels.

## Solution: Add Missing Pixel Permissions

### Step 1: Update Access Scopes
Edit `shopify.app.toml`:

```toml
[access_scopes]
scopes = "read_orders,write_files,write_products,write_pixels,read_customer_events"
```

### Step 2: Redeploy with Pixel Permissions
```bash
shopify app deploy --force
```

When prompted, select:
- **(y) Yes, release this new version**

### Step 3: Update App Permissions
After deployment:
1. Go to your app in Shopify Admin
2. You'll see a permission update request
3. Accept the new permissions

### Step 4: Install the Pixel
Now the pixel should appear in Customer Events!

## Alternative: Direct Pixel Installation

If the above doesn't work, you can manually install via GraphQL:

```graphql
mutation {
  webPixelCreate(webPixel: {
    settings: {
      app_url: "https://shopify-txl.dreamshot.io",
      enabled: "true",
      debug: "true"
    }
  }) {
    webPixel {
      id
      settings
    }
    userErrors {
      field
      message
    }
  }
}
```

## Quick Check Commands

Check if pixel is in your deployment:
```bash
ls -la extensions/ab-test-pixel/
```

Check your current scopes:
```bash
shopify app env show
```

## Direct Links
- **Customer Events:** https://admin.shopify.com/store/genlabs-dev-store/settings/customer_events
- **App Settings:** https://admin.shopify.com/store/genlabs-dev-store/apps/dreamshot-model-swap

## The Key Insight
Your app HAS the pixel code but lacks the PERMISSION to install it. Just like other apps that successfully installed their pixels, you need the `write_pixels` scope!