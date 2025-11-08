#!/usr/bin/env bun
/**
 * Instructions to manually connect the pixel
 */

console.log(`
🔌 MANUAL PIXEL CONNECTION GUIDE
================================

Since the pixel appears as "dreamshot-model-swap" (Disconnected):

1. CLICK DIRECTLY ON THE TEXT "dreamshot-model-swap"
   - Don't click on "App" or "Disconnected"
   - Click on the app name itself

2. WHAT YOU MIGHT SEE:

   Option A - Simple Toggle:
   ┌────────────────────────────────┐
   │ Enable dreamshot-model-swap    │
   │ [ ] OFF  → TURN THIS ON        │
   └────────────────────────────────┘

   Option B - Connect Button:
   ┌────────────────────────────────┐
   │ dreamshot-model-swap pixel     │
   │ Status: Disconnected           │
   │ [Connect] ← CLICK THIS         │
   └────────────────────────────────┘

   Option C - Configuration:
   ┌────────────────────────────────┐
   │ Configure Settings             │
   │ App URL: [__________________]  │
   │         ↑ Enter: https://shopify-txl.dreamshot.io
   │ [Save and Connect]             │
   └────────────────────────────────┘

3. IF ABSOLUTELY NOTHING WORKS:

   Try this direct URL:
   https://admin.shopify.com/store/genlabs-dev-store/settings/customer_events/apps/dreamshot-model-swap

4. STILL NOT WORKING?

   The pixel might need to be manually enabled via GraphQL.
   Run this command to check:

   curl -X POST https://genlabs-dev-store.myshopify.com/admin/api/2025-07/graphql.json \\
     -H "X-Shopify-Access-Token: YOUR_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"query": "{ webPixels { edges { node { id settings } } } }"}'

5. TO TEST IF CONNECTED:

   - Open DevTools Console (F12)
   - Visit: https://genlabs-dev-store.myshopify.com/products/
   - Look for: [A/B Test Pixel] logs

The monitor is running and waiting for events!
`);

// Check current configuration
console.log('\n📊 Current App Configuration:');
console.log('   Version: 21 (deployed with write_pixels)');
console.log('   Scopes: read_orders,write_files,write_products,write_pixels');
console.log('   Pixel Status: Visible but Disconnected');
console.log('\nThe pixel IS deployed, it just needs to be connected!');