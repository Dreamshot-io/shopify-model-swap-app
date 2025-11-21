# Statistics Export System - Complete Guide

**Last Updated**: November 21, 2025

## Overview

This document covers the complete statistics export system, including authentication, pixel tracking, data collection, and automated exports.

## Quick Status Check

```bash
# Check if pixels are tracking
bun run --env-file=.env scripts/check-pixel-status.ts

# Link sessions to credentials (if needed)
bun run link:sessions

# Backfill statistics manually
bun run backfill:statistics -- --days 5

# Check AB tests
SELECT COUNT(*) FROM "ABTest" WHERE status = 'ACTIVE';

# Check events
SELECT COUNT(*) FROM "ABTestEvent";
```

## Current State (as of last update)

✅ **Working**:
- Cron job configured in vercel.json (runs daily at midnight UTC)
- All 4 shops have sessions properly linked to credentials
- Backfill script works for all shops (handles custom domains)
- Image backup uses upsert (idempotent)
- CRON_SECRET automatically provided by Vercel

⚠️ **Expected Behavior**:
- Exports show 0 values because no AB test events exist
- This is CORRECT - system exports accurate state
- Will show real data once AB tests are created and traffic flows

## Architecture

### Component Stack

```
┌─────────────────────────────────────────────────┐
│  Storefront (Customer browses products)         │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│  ab-test-pixel (Web Pixel Extension)            │
│  - Tracks impressions, add-to-carts, purchases  │
│  - Sends events to /track endpoint              │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│  ABTestEvent Table                               │
│  - Stores raw event data                        │
│  - Links to AB tests via testId                 │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│  Vercel Cron (Daily at 00:00 UTC)              │
│  - Triggers /api/statistics-export/daily        │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│  Statistics Export Pipeline                     │
│  1. Fetch all active shops                      │
│  2. For each shop, fetch products               │
│  3. For each variant, calculate metrics         │
│  4. Backup images to R2                         │
│  5. Generate CSV/JSON exports                   │
│  6. Save to StatisticsExport table              │
│  7. Save to VariantDailyStatistics table        │
└─────────────────────────────────────────────────┘
```

## Data Model

### Key Tables

#### ShopCredential
- Stores OAuth app credentials (API key/secret)
- `mode: PUBLIC` or `PRIVATE`
- Links to sessions via `Session.shopId` FK

#### Session  
- Stores OAuth access tokens
- `shop`: myshopify.com domain
- `accessToken`: Used for all API calls
- `shopId`: FK to ShopCredential

#### ABTest
- Defines A/B test configuration
- Links to shop via `shop` field (shopId)
- Status: DRAFT, ACTIVE, PAUSED, COMPLETED

#### ABTestEvent
- Raw event tracking data
- Types: IMPRESSION, ADD_TO_CART, PURCHASE
- Links to ABTest via `testId`

#### StatisticsExport
- Daily export metadata
- R2 storage keys for CSV/JSON
- Snapshot of metrics/images

#### VariantDailyStatistics
- Queryable metrics per variant per day
- Aggregated from ABTestEvent
- Pre-computed CTR and conversion rate

## Authentication Flow

### OAuth Apps (Public & Private)

**Key Insight**: API key/secret are ONLY for OAuth configuration. Actual API calls use the `accessToken`.

```typescript
// ShopCredential stores OAuth app config
{
  apiKey: "abc123...",      // OAuth client ID
  apiSecret: "shpss_...",   // OAuth client secret (for validation)
  mode: "PUBLIC" | "PRIVATE"
}

// Session stores the actual API authentication
{
  shop: "store.myshopify.com",  // myshopify domain
  accessToken: "shpca_...",     // THIS is used for API calls
  shopId: "credential_id"        // Links to ShopCredential
}

// API calls only need accessToken
fetch('https://store.myshopify.com/admin/api/2025-01/graphql.json', {
  headers: {
    'X-Shopify-Access-Token': session.accessToken  // ✅ Just the token!
  }
})
```

### Session Linking

Sessions are linked to credentials via `Session.shopId` FK, NOT by domain matching:

```typescript
// ❌ WRONG - Domain matching fails for custom domains
const session = await prisma.session.findFirst({
  where: { shop: shopDomain }  // Fails: bumbba.com vs charming-heroic-vulture.myshopify.com
});

// ✅ CORRECT - Use FK relationship
const credential = await prisma.shopCredential.findUnique({
  where: { shopDomain }
});
const session = await prisma.session.findFirst({
  where: { shopId: credential.id }  // Works with custom domains
});
```

## Web Pixel Setup

### Extension Configuration

Located in: `extensions/ab-test-pixel/`

```toml
# shopify.extension.toml
api_version = "2025-07"
name = "ab-test-pixel"
uid = "ecaa6226-8e43-2519-e06f-e0ea40d84876e26a2ae3"
type = "web_pixel_extension"

[settings.fields.app_url]
name = "App URL"
type = "single_line_text_field"
# Must be set to: https://shopify.dreamshot.io

[settings.fields.enabled]
name = "Enable A/B Testing"
type = "single_line_text_field"

[settings.fields.debug]
name = "Debug Mode"
type = "single_line_text_field"
```

### Manual Configuration Required

**The pixel CANNOT be activated programmatically**. Each shop must manually configure it:

1. Shopify Admin → Settings → Customer Events
2. Find "ab-test-pixel" 
3. Click to configure
4. Set values:
   - `app_url`: https://shopify.dreamshot.io
   - `enabled`: true
   - `debug`: false
5. Click "Connect" or "Save"

### Event Tracking

The pixel tracks events when:
- ✅ Pixel is configured
- ✅ AB test exists for the product
- ✅ AB test status is ACTIVE
- ✅ Customer views/interacts with product page

Event flow:
```javascript
// Pixel detects product page view
→ Checks for active AB test
→ Sends event to /track endpoint
→ Event saved to ABTestEvent table
```

## Statistics Export Pipeline

### Daily Cron Job

**Configuration**: `vercel.json`
```json
{
  "crons": [{
    "path": "/api/statistics-export/daily",
    "schedule": "0 0 * * *"  // Daily at midnight UTC
  }]
}
```

**Authentication**: 
- Vercel automatically provides `CRON_SECRET` in production
- Sets `Authorization: Bearer ${CRON_SECRET}` header
- Sets `User-Agent: vercel-cron/1.0`

### Export Process

**Route**: `app/routes/api.statistics-export.daily.tsx`

**Steps**:
1. Validate CRON_SECRET
2. Get yesterday's date (UTC)
3. Fetch all active shops from ShopCredential
4. For each shop:
   - Get session via shopId FK
   - Fetch products from Shopify
   - For each product variant:
     - Calculate metrics from ABTestEvent
     - Backup product images to R2
     - Format to CSV/JSON
     - Upload to R2
     - Save to StatisticsExport
     - Save to VariantDailyStatistics

### Metrics Calculation

**Service**: `app/services/statistics-export/metrics-calculator.service.ts`

```typescript
// Aggregates ABTestEvent records for a variant/date
function getVariantMetricsForDate(shopId, productId, variantId, date) {
  // Query ABTestEvent where:
  // - test.shop = shopId
  // - productId = productId  
  // - variantId = variantId
  // - createdAt between date 00:00 and 23:59 UTC
  
  // Calculate:
  impressions = count(eventType = 'IMPRESSION')
  addToCarts = count(eventType = 'ADD_TO_CART')
  orders = count(eventType = 'PURCHASE')
  revenue = sum(event.revenue where eventType = 'PURCHASE')
  ctr = addToCarts / impressions (avoid division by zero)
  
  return { impressions, addToCarts, ctr, orders, revenue }
}
```

### Image Backup

**Service**: `app/services/statistics-export/image-backup.service.ts`

**Purpose**: Preserve product images in case they're deleted from Shopify

**Process**:
1. Fetch images from Shopify
2. Download from Shopify CDN
3. Upload to R2 storage
4. Upsert to ProductImageBackup table (idempotent)
5. Link to VariantDailyStatistics

**R2 Key Format**:
```
product-images/{shopId}/{productId}/{variantId}/{mediaId}.{ext}
```

## Manual Backfill

### When to Use

- Initial setup (historical data)
- After system changes
- To fill gaps from missed cron runs

### Scripts

#### 1. Link Sessions to Credentials
```bash
bun run link:sessions
```

**Purpose**: Fix Session.shopId for existing sessions

**How it works**:
- Queries shops via Shopify API to get primary/myshopify domains
- Matches sessions to credentials
- Updates Session.shopId FK

#### 2. Check Pixel Status
```bash
bun run --env-file=.env scripts/check-pixel-status.ts
```

**Purpose**: Verify pixel is tracking events

**Output**: Shows count of ABTestEvent per shop

#### 3. Backfill Statistics
```bash
# Last 5 days (default)
bun run backfill:statistics

# Specific number of days
bun run backfill:statistics -- --days 7

# Specific date range
bun run backfill:statistics -- --start 2025-01-01 --end 2025-01-05

# Dry run (preview)
bun run backfill:statistics -- --days 3 --dry-run
```

**Features**:
- Idempotent: Skips dates with existing exports
- Uses shopId FK for session lookup (handles custom domains)
- Processes all active shops
- Same logic as cron job

## Troubleshooting

### No Statistics Being Generated

**Check 1**: Are AB tests created?
```sql
SELECT COUNT(*) FROM "ABTest" WHERE status = 'ACTIVE';
```

**Check 2**: Is pixel configured?
- Visit each shop's Shopify Admin → Settings → Customer Events
- Verify "ab-test-pixel" is connected

**Check 3**: Are events being tracked?
```sql
SELECT COUNT(*) FROM "ABTestEvent" WHERE "createdAt" > NOW() - INTERVAL '1 day';
```

**Check 4**: Test pixel on storefront
- Open DevTools Console (F12)
- Visit a product page with active AB test
- Look for `[A/B Test Pixel]` logs

### Exports Showing Zero Values

This is **expected behavior** when:
- No AB tests exist
- AB tests exist but status ≠ ACTIVE
- No traffic to product pages
- Pixel not configured

**The system is working correctly** - it's exporting the accurate state (no events = 0 metrics).

### Session Not Found Errors

**Symptom**: `No valid session found for shop: domain.com`

**Cause**: Session.shopId is null (not linked to credential)

**Fix**:
```bash
bun run link:sessions
```

### Custom Domain Issues

**Symptom**: Works with myshopify.com but not custom domain

**Root Cause**: Session lookup by domain fails for custom domains

**Solution**: Updated code to use shopId FK instead of domain matching

**Before**:
```typescript
const session = await prisma.session.findFirst({
  where: { shop: shopDomain }  // ❌ Fails with custom domains
});
```

**After**:
```typescript
const credential = await prisma.shopCredential.findUnique({
  where: { shopDomain }
});
const session = await prisma.session.findFirst({
  where: { shopId: credential.id }  // ✅ Works with custom domains
});
```

## Key Files

### Configuration
- `vercel.json` - Cron job definition
- `extensions/ab-test-pixel/shopify.extension.toml` - Pixel config

### Routes
- `app/routes/api.statistics-export.daily.tsx` - Cron endpoint
- `app/routes/track.tsx` - Event tracking endpoint

### Services (Statistics Export)
- `app/services/statistics-export/`
  - `statistics-export-orchestrator.service.ts` - Main orchestrator
  - `metrics-calculator.service.ts` - Calculate metrics from events
  - `image-backup.service.ts` - Backup images to R2
  - `export-formatter.service.ts` - Format to CSV/JSON
  - `export-storage.service.ts` - Upload to R2
  - `statistics-persistence.service.ts` - Save to database
  - `product-fetcher.service.ts` - Fetch from Shopify

### Scripts
- `scripts/backfill-daily-statistics.ts` - Manual backfill
- `scripts/link-sessions-to-credentials.ts` - Fix session links
- `scripts/check-pixel-status.ts` - Verify pixel tracking
- `scripts/activate-pixel-all-shops.ts` - Attempted programmatic activation (doesn't work)

### Database Models
- `prisma/schema.prisma`:
  - ShopCredential
  - Session
  - ABTest
  - ABTestEvent
  - StatisticsExport
  - VariantDailyStatistics
  - ProductImageBackup

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection
- `DIRECT_URL` - Direct PostgreSQL connection (for migrations)
- `CRON_SECRET` - Vercel provides automatically in production

### Optional (for local development)
- `CRON_SECRET` - For testing cron endpoint locally

## npm Scripts

```bash
# Statistics export
bun run backfill:statistics          # Backfill historical data
bun run link:sessions                # Link sessions to credentials

# Pixel management  
bun run activate:pixels              # (Doesn't work - manual config needed)

# Development
bun run dev                          # Start dev server
bun run build                        # Build for production
bun run test                         # Run tests
```

## Summary

### What's Working
✅ Cron job configured and active
✅ Sessions linked to credentials
✅ Backfill script functional
✅ Image backup with upsert (idempotent)
✅ Statistics export pipeline complete

### What's Expected
⚠️ Exports show 0 values because no AB test events exist
⚠️ This is correct behavior - system works as designed

### To Get Real Data
1. Create AB tests in the app
2. Set AB test status to ACTIVE
3. Ensure pixel is configured in each shop
4. Drive traffic to product pages
5. System will automatically export real metrics daily
