# ShopifyQL Hybrid Impressions Tracking - Implementation Plan

## Overview

Replace undercounted pixel-based impression tracking with ShopifyQL server-side analytics, using the existing pixel only for A/B variant distribution.

**Problem:** CTR 6.85%, CVR 9.78% (should be 2-4%) → impressions undercounted by ~60-70%
**Solution:** ShopifyQL `view_sessions` as ground truth + pixel ratio for variant split

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     HYBRID TRACKING ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────┐         ┌─────────────────────────────────┐     │
│  │  ShopifyQL Query   │         │   Existing Web Pixel            │     │
│  │  (Server-side)     │         │   (Client-side)                 │     │
│  │                    │         │                                 │     │
│  │  view_sessions     │         │   IMPRESSION events with        │     │
│  │  cart_sessions     │         │   activeCase (BASE/TEST)        │     │
│  │  purchase_sessions │         │                                 │     │
│  └─────────┬──────────┘         └──────────────┬──────────────────┘     │
│            │                                   │                         │
│            │ Total Views                       │ Variant Ratio           │
│            │ (Ground Truth)                    │ (Distribution)          │
│            │                                   │                         │
│            └─────────────┬─────────────────────┘                         │
│                          │                                               │
│                          ▼                                               │
│            ┌─────────────────────────────┐                               │
│            │   Statistics Calculation     │                              │
│            │                              │                              │
│            │   baseImpressions =          │                              │
│            │     totalViews × baseRatio   │                              │
│            │                              │                              │
│            │   testImpressions =          │                              │
│            │     totalViews × testRatio   │                              │
│            └─────────────────────────────┘                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Add `read_reports` Scope

**File:** `shopify.app.toml`

**Current (line 37):**
```toml
scopes = "read_orders,write_files,write_products,write_pixels,read_customer_events,write_script_tags"
```

**Change to:**
```toml
scopes = "read_orders,write_files,write_products,write_pixels,read_customer_events,write_script_tags,read_reports"
```

**Note:** Existing merchants will need to re-authenticate to grant the new scope.

---

### Step 2: Create ShopifyQL Analytics Service

**File:** `app/services/shopify-analytics.server.ts` (NEW)

```typescript
import type { AdminApiContext } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/clients";

export interface ProductAnalytics {
  productId: string;
  viewSessions: number;
  cartSessions: number;
  purchaseSessions: number;
  date: string;
}

export interface ProductAnalyticsSummary {
  totalViews: number;
  totalCarts: number;
  totalPurchases: number;
  dailyBreakdown: ProductAnalytics[];
}

export class ShopifyAnalyticsService {
  /**
   * Query ShopifyQL for product page views using the Products Dataset.
   * Returns view_sessions (total sessions where product was viewed).
   */
  static async getProductAnalytics(
    admin: AdminApiContext["admin"],
    productId: string,
    sinceDays: number = 30
  ): Promise<ProductAnalyticsSummary> {
    // Extract numeric product ID from GID if needed
    const numericId = productId.replace("gid://shopify/Product/", "");

    const query = `
      FROM products
      SHOW
        product_id,
        sum(view_sessions) AS views,
        sum(cart_sessions) AS carts,
        sum(purchase_sessions) AS purchases
      WHERE product_id = ${numericId}
      GROUP BY product_id, day
      SINCE -${sinceDays}d
      ORDER BY day ASC
    `;

    const response = await admin.graphql(`
      query ShopifyQLProductViews {
        shopifyqlQuery(query: """${query}""") {
          tableData {
            columns {
              name
              dataType
            }
            rows
          }
          parseErrors
        }
      }
    `);

    const json = await response.json();
    const data = json.data?.shopifyqlQuery;

    if (data?.parseErrors?.length > 0) {
      console.error("ShopifyQL parse errors:", data.parseErrors);
      throw new Error(`ShopifyQL query failed: ${data.parseErrors.join(", ")}`);
    }

    const rows = data?.tableData?.rows || [];
    const columns = data?.tableData?.columns || [];

    // Find column indices
    const viewsIndex = columns.findIndex((c: { name: string }) => c.name === "views");
    const cartsIndex = columns.findIndex((c: { name: string }) => c.name === "carts");
    const purchasesIndex = columns.findIndex((c: { name: string }) => c.name === "purchases");
    const dayIndex = columns.findIndex((c: { name: string }) => c.name === "day");

    const dailyBreakdown: ProductAnalytics[] = rows.map((row: string[]) => ({
      productId: numericId,
      viewSessions: parseInt(row[viewsIndex] || "0", 10),
      cartSessions: parseInt(row[cartsIndex] || "0", 10),
      purchaseSessions: parseInt(row[purchasesIndex] || "0", 10),
      date: row[dayIndex] || "",
    }));

    // Calculate totals
    const totalViews = dailyBreakdown.reduce((sum, d) => sum + d.viewSessions, 0);
    const totalCarts = dailyBreakdown.reduce((sum, d) => sum + d.cartSessions, 0);
    const totalPurchases = dailyBreakdown.reduce((sum, d) => sum + d.purchaseSessions, 0);

    return {
      totalViews,
      totalCarts,
      totalPurchases,
      dailyBreakdown,
    };
  }

  /**
   * Query hourly granularity for time-based A/B test correlation.
   * Useful for correlating with 30-minute rotation windows.
   */
  static async getProductAnalyticsByHour(
    admin: AdminApiContext["admin"],
    productId: string,
    sinceDays: number = 7
  ): Promise<Array<{ hour: string; views: number; carts: number; purchases: number }>> {
    const numericId = productId.replace("gid://shopify/Product/", "");

    const query = `
      FROM products
      SHOW
        sum(view_sessions) AS views,
        sum(cart_sessions) AS carts,
        sum(purchase_sessions) AS purchases
      WHERE product_id = ${numericId}
      GROUP BY hour
      SINCE -${sinceDays}d
      ORDER BY hour ASC
    `;

    const response = await admin.graphql(`
      query ShopifyQLProductViewsByHour {
        shopifyqlQuery(query: """${query}""") {
          tableData {
            columns { name }
            rows
          }
          parseErrors
        }
      }
    `);

    const json = await response.json();
    const data = json.data?.shopifyqlQuery;

    if (data?.parseErrors?.length > 0) {
      throw new Error(`ShopifyQL query failed: ${data.parseErrors.join(", ")}`);
    }

    const rows = data?.tableData?.rows || [];
    const columns = data?.tableData?.columns || [];

    const hourIndex = columns.findIndex((c: { name: string }) => c.name === "hour");
    const viewsIndex = columns.findIndex((c: { name: string }) => c.name === "views");
    const cartsIndex = columns.findIndex((c: { name: string }) => c.name === "carts");
    const purchasesIndex = columns.findIndex((c: { name: string }) => c.name === "purchases");

    return rows.map((row: string[]) => ({
      hour: row[hourIndex] || "",
      views: parseInt(row[viewsIndex] || "0", 10),
      carts: parseInt(row[cartsIndex] || "0", 10),
      purchases: parseInt(row[purchasesIndex] || "0", 10),
    }));
  }
}
```

---

### Step 3: Create Hybrid Statistics Calculator

**File:** `app/services/hybrid-statistics.server.ts` (NEW)

```typescript
import type { ABTestEvent } from "@prisma/client";
import { ShopifyAnalyticsService, type ProductAnalyticsSummary } from "./shopify-analytics.server";
import type { AdminApiContext } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/clients";

export interface HybridStatistics {
  base: VariantStats;
  test: VariantStats;
  lift: number;
  totalSessions: number;
  // Debug/transparency data
  debug: {
    shopifyTotalViews: number;
    pixelTotalImpressions: number;
    pixelCaptureRate: number; // percentage
    baseRatio: number;
    testRatio: number;
  };
}

export interface VariantStats {
  impressions: number;
  addToCarts: number;
  conversions: number;
  revenue: number;
  cvr: number;
  atc: number;
}

export class HybridStatisticsService {
  /**
   * Calculate A/B test statistics using hybrid approach:
   * - ShopifyQL for ground truth total views
   * - Pixel data for variant distribution ratio
   * - Apply ratio to get per-variant impressions
   */
  static async calculate(
    admin: AdminApiContext["admin"],
    productId: string,
    events: ABTestEvent[],
    testCreatedAt: Date
  ): Promise<HybridStatistics> {
    // 1. Get ShopifyQL analytics (ground truth)
    const daysSinceCreation = Math.ceil(
      (Date.now() - testCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const sinceDays = Math.max(daysSinceCreation, 7); // At least 7 days

    let shopifyAnalytics: ProductAnalyticsSummary;
    try {
      shopifyAnalytics = await ShopifyAnalyticsService.getProductAnalytics(
        admin,
        productId,
        sinceDays
      );
    } catch (error) {
      console.error("ShopifyQL query failed, falling back to pixel-only:", error);
      // Fallback to pixel-only calculation
      return this.calculatePixelOnly(events);
    }

    // 2. Calculate pixel-based variant distribution
    const baseEvents = events.filter((e) => e.activeCase === "BASE");
    const testEvents = events.filter((e) => e.activeCase === "TEST");

    const pixelBaseImpressions = baseEvents.filter((e) => e.eventType === "IMPRESSION").length;
    const pixelTestImpressions = testEvents.filter((e) => e.eventType === "IMPRESSION").length;
    const pixelTotalImpressions = pixelBaseImpressions + pixelTestImpressions;

    // 3. Calculate ratios
    const baseRatio = pixelTotalImpressions > 0
      ? pixelBaseImpressions / pixelTotalImpressions
      : 0.5; // Default to 50/50 if no pixel data
    const testRatio = 1 - baseRatio;

    // 4. Apply ratios to ShopifyQL ground truth
    const shopifyTotalViews = shopifyAnalytics.totalViews;
    const adjustedBaseImpressions = Math.round(shopifyTotalViews * baseRatio);
    const adjustedTestImpressions = Math.round(shopifyTotalViews * testRatio);

    // 5. Keep ATC and purchases from pixel (more reliable for variant attribution)
    const baseAddToCarts = baseEvents.filter((e) => e.eventType === "ADD_TO_CART").length;
    const testAddToCarts = testEvents.filter((e) => e.eventType === "ADD_TO_CART").length;

    const baseConversions = baseEvents.filter((e) => e.eventType === "PURCHASE").length;
    const testConversions = testEvents.filter((e) => e.eventType === "PURCHASE").length;

    const baseRevenue = baseEvents
      .filter((e) => e.eventType === "PURCHASE" && e.revenue)
      .reduce((sum, e) => sum + Number(e.revenue), 0);
    const testRevenue = testEvents
      .filter((e) => e.eventType === "PURCHASE" && e.revenue)
      .reduce((sum, e) => sum + Number(e.revenue), 0);

    // 6. Calculate rates using adjusted impressions
    const baseCVR = adjustedBaseImpressions > 0
      ? (baseConversions / adjustedBaseImpressions) * 100
      : 0;
    const testCVR = adjustedTestImpressions > 0
      ? (testConversions / adjustedTestImpressions) * 100
      : 0;

    const baseATC = adjustedBaseImpressions > 0
      ? (baseAddToCarts / adjustedBaseImpressions) * 100
      : 0;
    const testATC = adjustedTestImpressions > 0
      ? (testAddToCarts / adjustedTestImpressions) * 100
      : 0;

    const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

    // 7. Calculate pixel capture rate for debugging
    const pixelCaptureRate = shopifyTotalViews > 0
      ? (pixelTotalImpressions / shopifyTotalViews) * 100
      : 0;

    return {
      base: {
        impressions: adjustedBaseImpressions,
        addToCarts: baseAddToCarts,
        conversions: baseConversions,
        revenue: baseRevenue,
        cvr: baseCVR,
        atc: baseATC,
      },
      test: {
        impressions: adjustedTestImpressions,
        addToCarts: testAddToCarts,
        conversions: testConversions,
        revenue: testRevenue,
        cvr: testCVR,
        atc: testATC,
      },
      lift,
      totalSessions: new Set(events.map((e) => e.sessionId)).size,
      debug: {
        shopifyTotalViews,
        pixelTotalImpressions,
        pixelCaptureRate,
        baseRatio,
        testRatio,
      },
    };
  }

  /**
   * Fallback: Calculate statistics using pixel data only.
   * Used when ShopifyQL is unavailable.
   */
  private static calculatePixelOnly(events: ABTestEvent[]): HybridStatistics {
    const baseEvents = events.filter((e) => e.activeCase === "BASE");
    const testEvents = events.filter((e) => e.activeCase === "TEST");

    const baseImpressions = baseEvents.filter((e) => e.eventType === "IMPRESSION").length;
    const testImpressions = testEvents.filter((e) => e.eventType === "IMPRESSION").length;

    const baseAddToCarts = baseEvents.filter((e) => e.eventType === "ADD_TO_CART").length;
    const testAddToCarts = testEvents.filter((e) => e.eventType === "ADD_TO_CART").length;

    const baseConversions = baseEvents.filter((e) => e.eventType === "PURCHASE").length;
    const testConversions = testEvents.filter((e) => e.eventType === "PURCHASE").length;

    const baseRevenue = baseEvents
      .filter((e) => e.eventType === "PURCHASE" && e.revenue)
      .reduce((sum, e) => sum + Number(e.revenue), 0);
    const testRevenue = testEvents
      .filter((e) => e.eventType === "PURCHASE" && e.revenue)
      .reduce((sum, e) => sum + Number(e.revenue), 0);

    const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
    const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;

    const baseATC = baseImpressions > 0 ? (baseAddToCarts / baseImpressions) * 100 : 0;
    const testATC = testImpressions > 0 ? (testAddToCarts / testImpressions) * 100 : 0;

    const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

    return {
      base: {
        impressions: baseImpressions,
        addToCarts: baseAddToCarts,
        conversions: baseConversions,
        revenue: baseRevenue,
        cvr: baseCVR,
        atc: baseATC,
      },
      test: {
        impressions: testImpressions,
        addToCarts: testAddToCarts,
        conversions: testConversions,
        revenue: testRevenue,
        cvr: testCVR,
        atc: testATC,
      },
      lift,
      totalSessions: new Set(events.map((e) => e.sessionId)).size,
      debug: {
        shopifyTotalViews: baseImpressions + testImpressions, // Use pixel as fallback
        pixelTotalImpressions: baseImpressions + testImpressions,
        pixelCaptureRate: 100, // Assume 100% when no ground truth available
        baseRatio: baseImpressions / (baseImpressions + testImpressions) || 0.5,
        testRatio: testImpressions / (baseImpressions + testImpressions) || 0.5,
      },
    };
  }
}
```

---

### Step 4: Update A/B Test Detail Loader

**File:** `app/routes/app.ab-tests.$id.tsx`

**Changes to `loader` function (lines 23-106):**

Replace the manual statistics calculation with `HybridStatisticsService`:

```typescript
import { HybridStatisticsService } from "~/services/hybrid-statistics.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const testId = params.id;

  if (!testId) {
    throw new Response('Test ID required', { status: 400 });
  }

  const test = await db.aBTest.findUnique({
    where: { id: testId },
    include: {
      variants: true,
      events: {
        orderBy: { createdAt: 'desc' },
        take: 1000,
      },
      rotationEvents: {
        orderBy: { timestamp: 'desc' },
        take: 20,
      },
      auditLogs: {
        orderBy: { timestamp: 'desc' },
        take: 50,
      },
    },
  });

  if (!test || test.shop !== session.shop) {
    throw new Response('Test not found', { status: 404 });
  }

  // NEW: Use hybrid statistics calculation
  const statistics = await HybridStatisticsService.calculate(
    admin,
    test.productId,
    test.events,
    test.createdAt
  );

  return json({
    test,
    statistics,
  });
};
```

---

### Step 5: Update Statistics Display Components

**File:** `app/routes/app.ab-tests.$id.tsx` (UI portion)

Add debug information panel to show tracking accuracy:

```typescript
// In the component, add after the stats table:

{statistics.debug && (
  <Card>
    <BlockStack gap="200">
      <Text variant="headingSm" as="h3">Tracking Accuracy</Text>
      <InlineStack gap="400">
        <Box>
          <Text variant="bodySm" tone="subdued">ShopifyQL Views</Text>
          <Text variant="bodyMd">{statistics.debug.shopifyTotalViews.toLocaleString()}</Text>
        </Box>
        <Box>
          <Text variant="bodySm" tone="subdued">Pixel Captured</Text>
          <Text variant="bodyMd">{statistics.debug.pixelTotalImpressions.toLocaleString()}</Text>
        </Box>
        <Box>
          <Text variant="bodySm" tone="subdued">Capture Rate</Text>
          <Text variant="bodyMd">{statistics.debug.pixelCaptureRate.toFixed(1)}%</Text>
        </Box>
        <Box>
          <Text variant="bodySm" tone="subdued">Variant Split</Text>
          <Text variant="bodyMd">
            BASE: {(statistics.debug.baseRatio * 100).toFixed(1)}% /
            TEST: {(statistics.debug.testRatio * 100).toFixed(1)}%
          </Text>
        </Box>
      </InlineStack>
    </BlockStack>
  </Card>
)}
```

---

### Step 6: Update Dashboard Statistics

**File:** `app/routes/app._index.tsx`

Update the dashboard to aggregate hybrid statistics across all active tests.

(Details depend on current dashboard implementation - adjust `loader` to use `HybridStatisticsService` for each active test)

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `shopify.app.toml` | MODIFY | Add `read_reports` scope |
| `app/services/shopify-analytics.server.ts` | CREATE | ShopifyQL query service |
| `app/services/hybrid-statistics.server.ts` | CREATE | Hybrid stats calculator |
| `app/routes/app.ab-tests.$id.tsx` | MODIFY | Use hybrid statistics in loader |
| `app/routes/app._index.tsx` | MODIFY | Update dashboard aggregation |
| `extensions/ab-test-pixel/src/index.ts` | NO CHANGE | Keep for variant distribution |

---

## Testing Plan

1. **Unit Tests** for `ShopifyAnalyticsService`:
   - Mock GraphQL responses
   - Test query construction with different product IDs
   - Test error handling for parse errors

2. **Unit Tests** for `HybridStatisticsService`:
   - Test ratio calculation with various pixel distributions
   - Test fallback when ShopifyQL fails
   - Test edge cases (no events, all BASE, all TEST)

3. **Integration Tests**:
   - Test actual ShopifyQL queries against dev store
   - Verify scope requirements

4. **Manual Testing**:
   - Compare old vs new impressions counts
   - Verify CVR/CTR now fall in normal ranges (2-4%)
   - Check pixel capture rate visibility

---

## Expected Results

| Metric | Before (Pixel Only) | After (Hybrid) |
|--------|---------------------|----------------|
| Impressions | ~2,320 (undercounted) | ~6,000-8,000 |
| CTR | 6.85% (inflated) | ~2.5-3% |
| CVR | 9.78% (inflated) | ~3-4% |
| Pixel Capture Rate | Unknown | ~30-40% (visible) |

---

## Rollback Plan

If ShopifyQL returns unexpected data or causes issues:
1. `HybridStatisticsService.calculate()` already falls back to pixel-only
2. Can disable by removing `read_reports` scope
3. Statistics calculation is isolated - no database schema changes required
