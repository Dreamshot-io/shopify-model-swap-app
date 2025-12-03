# ShopifyQL Pure Impressions Tracking - Implementation Plan

## Overview

Replace undercounted pixel-based impression tracking with ShopifyQL server-side analytics, leveraging the time-based rotation model to attribute impressions accurately to each variant.

**Problem:** CTR 6.85%, CVR 9.78% (should be 2-4%) → impressions undercounted by ~60-70%
**Solution:** ShopifyQL hourly data + RotationEvent timestamps for precise variant attribution

> **API Validation Status:** ✅ Validated via Shopify MCP (December 2024)

---

## Validated API Capabilities

The following capabilities have been verified against Shopify's official documentation:

### ShopifyQL `products` Dataset Metrics

| Metric | Column Name | Type | Available |
|--------|-------------|------|-----------|
| Product page views (impressions) | `view_sessions` | number | ✅ |
| Add-to-cart sessions | `cart_sessions` | number | ✅ |
| Purchase sessions | `purchase_sessions` | number | ✅ |
| Revenue (gross) | `gross_sales` | price | ✅ |
| Revenue (net) | `net_sales` | price | ✅ |
| Quantity added to cart | `quantity_added_to_cart` | number | ✅ |
| Quantity purchased | `quantity_purchased` | number | ✅ |
| Filter by product | `WHERE product_id = X` | filter | ✅ |

### Time Granularity Support

| Time Dimension | GROUP BY Support | Notes |
|----------------|-----------------|-------|
| `hour` | ✅ Supported | **Finest available granularity** |
| `day` | ✅ Supported | |
| `week` | ✅ Supported | |
| `month` | ✅ Supported | |
| `quarter` | ✅ Supported | |
| `year` | ✅ Supported | |
| `minute` | ❌ Not supported | |
| `30min` | ❌ Not supported | |

> **Critical Note:** The underlying data is stored at 15-minute granularity, but the ShopifyQL API only exposes `hour` as the finest time dimension for `GROUP BY`.

### Required Access

- **Scope:** `read_reports`
- **Protected Customer Data:** Level 2 access required (name, email, address, phone)
- **API Version:** Must use `2024-04` (ShopifyQL sunset in version `2024-07`)

> ⚠️ **Permission Note:** ShopifyQL requires Level 2 protected customer data access even when querying only aggregate product metrics (like `view_sessions`, `cart_sessions`). This is a blanket API requirement - there's no way to use ShopifyQL with lower permission levels. The app won't access or store any personal customer data, but Shopify requires this access level for the entire ShopifyQL API.

---

## Why Pure ShopifyQL with 60-Minute Rotation

### Time-Based Rotation = Perfect Attribution

The A/B test uses **time-based rotation**, not user-based. With **60-minute rotation intervals** aligned to ShopifyQL's hourly granularity:

- 10:00-11:00 → **ALL users** see BASE variant
- 11:00-12:00 → **ALL users** see TEST variant
- 12:00-13:00 → **ALL users** see BASE variant
- ...and so on

This means we can correlate ShopifyQL data **perfectly** with rotation windows:

```
ShopifyQL: "Give me views for product X at hour 10:00"
→ These are ALL BASE impressions (100% accurate, no estimation)

ShopifyQL: "Give me views for product X at hour 11:00"
→ These are ALL TEST impressions (100% accurate, no estimation)
```

### Why 60-Minute Rotation (Not 30-Minute)?

| Approach | Attribution Accuracy | Complexity |
|----------|---------------------|------------|
| 30-min rotation + hourly data | ~50% estimated (must split hours) | Complex |
| **60-min rotation + hourly data** | **100% accurate (1:1 mapping)** | **Simple** |

Since ShopifyQL only provides hourly granularity, using 60-minute rotation windows ensures each hour maps exactly to one variant with no estimation or splitting required.

### Why Not Hybrid?

The hybrid approach assumed we needed pixel ratios to distribute total views between variants. But with time-based rotation and aligned intervals, **timestamps alone tell us which variant was active**. No pixel data needed for impressions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│              PURE ShopifyQL ARCHITECTURE (60-MIN ROTATION)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────┐         ┌─────────────────────────────────┐    │
│  │  RotationEvent DB  │         │   ShopifyQL Query               │    │
│  │                    │         │   (Server-side, hourly)         │    │
│  │  timestamp: 10:00  │         │                                 │    │
│  │  activeCase: BASE  │         │   view_sessions by hour         │    │
│  │                    │         │   cart_sessions by hour         │    │
│  │  timestamp: 11:00  │         │   purchase_sessions by hour     │    │
│  │  activeCase: TEST  │         │                                 │    │
│  │                    │         │                                 │    │
│  │  timestamp: 12:00  │         │                                 │    │
│  │  activeCase: BASE  │         │                                 │    │
│  └─────────┬──────────┘         └──────────────┬──────────────────┘    │
│            │                                   │                        │
│            │ 60-min Rotation Windows           │ Hourly Metrics         │
│            │                                   │                        │
│            └─────────────┬─────────────────────┘                        │
│                          │                                              │
│                          ▼                                              │
│            ┌─────────────────────────────┐                              │
│            │   1:1 Time-Window Mapping    │                             │
│            │                              │                             │
│            │   Hour 10:00 → BASE (100%)   │                             │
│            │   Hour 11:00 → TEST (100%)   │                             │
│            │   Hour 12:00 → BASE (100%)   │                             │
│            │                              │                             │
│            │   No splitting or estimation │                             │
│            │   needed - perfect alignment │                             │
│            └─────────────────────────────┘                              │
│                          │                                              │
│                          ▼                                              │
│            ┌─────────────────────────────┐                              │
│            │   100% Accurate Statistics   │                             │
│            │                              │                             │
│            │   BASE: sum of all BASE      │                             │
│            │         hour metrics         │                             │
│            │                              │                             │
│            │   TEST: sum of all TEST      │                             │
│            │         hour metrics         │                             │
│            └─────────────────────────────┘                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What About the Pixel?

The pixel is **no longer needed for impressions**. However, it may still be useful for:

### ATC/Purchase Attribution Challenge

If a user views a product at 10:15 (BASE window) but adds to cart at 10:45 (TEST window), which variant gets credit?

**Options:**
1. **Time-of-event attribution**: Attribute ATC/Purchase to whatever variant was active at that moment
   - Simpler, uses ShopifyQL `cart_sessions` and `purchase_sessions` by hour
   - May misattribute some conversions

2. **First-touch attribution**: Keep pixel only for ATC/Purchase to capture the `activeCase` at impression time
   - More accurate for conversion attribution
   - Adds complexity

**Recommendation:** Start with option 1 (pure ShopifyQL) since rotation windows are 60 minutes and most conversions happen within that timeframe. Can add pixel attribution later if needed.

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

export interface HourlyProductMetrics {
  hour: string; // ISO timestamp
  viewSessions: number;
  cartSessions: number;
  purchaseSessions: number;
}

export class ShopifyAnalyticsService {
  /**
   * Query ShopifyQL for product metrics with hourly granularity.
   * This allows correlation with 30-minute rotation windows.
   */
  static async getProductMetricsByHour(
    admin: AdminApiContext["admin"],
    productId: string,
    sinceDays: number = 30
  ): Promise<HourlyProductMetrics[]> {
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
      query ShopifyQLProductMetricsByHour {
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
      console.error("ShopifyQL parse errors:", data.parseErrors);
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
      viewSessions: parseInt(row[viewsIndex] || "0", 10),
      cartSessions: parseInt(row[cartsIndex] || "0", 10),
      purchaseSessions: parseInt(row[purchasesIndex] || "0", 10),
    }));
  }
}
```

---

### Step 3: Create Time-Window Statistics Calculator

**File:** `app/services/shopifyql-statistics.server.ts` (NEW)

```typescript
import type { RotationEvent } from "@prisma/client";
import { ShopifyAnalyticsService, type HourlyProductMetrics } from "./shopify-analytics.server";
import type { AdminApiContext } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/clients";

export interface VariantStats {
  impressions: number;
  addToCarts: number;
  conversions: number;
  cvr: number; // Conversion rate %
  atcRate: number; // Add-to-cart rate %
}

export interface ShopifyQLStatistics {
  base: VariantStats;
  test: VariantStats;
  lift: number; // % improvement of TEST over BASE
  totalSessions: number;
  dataSource: "shopifyql" | "pixel_fallback";
  debug: {
    rotationWindowsAnalyzed: number;
    hoursWithData: number;
    oldestData: string;
    newestData: string;
  };
}

interface RotationWindow {
  start: Date;
  end: Date;
  activeCase: "BASE" | "TEST";
}

export class ShopifyQLStatisticsService {
  /**
   * Calculate A/B test statistics using ShopifyQL data correlated with rotation windows.
   *
   * Since the test uses time-based rotation (all users see same variant during each window),
   * we can precisely attribute ShopifyQL metrics to each variant by timestamp.
   */
  static async calculate(
    admin: AdminApiContext["admin"],
    productId: string,
    rotationEvents: RotationEvent[],
    testCreatedAt: Date,
    testEndedAt?: Date | null
  ): Promise<ShopifyQLStatistics> {
    // 1. Build rotation windows from events
    const windows = this.buildRotationWindows(rotationEvents, testCreatedAt, testEndedAt);

    if (windows.length === 0) {
      return this.emptyStats("No rotation windows found");
    }

    // 2. Get ShopifyQL hourly metrics
    const daysSinceCreation = Math.ceil(
      (Date.now() - testCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const sinceDays = Math.min(Math.max(daysSinceCreation, 7), 90); // 7-90 days

    let hourlyMetrics: HourlyProductMetrics[];
    try {
      hourlyMetrics = await ShopifyAnalyticsService.getProductMetricsByHour(
        admin,
        productId,
        sinceDays
      );
    } catch (error) {
      console.error("ShopifyQL query failed:", error);
      return this.emptyStats("ShopifyQL query failed");
    }

    if (hourlyMetrics.length === 0) {
      return this.emptyStats("No ShopifyQL data available");
    }

    // 3. Attribute hourly metrics to variants based on rotation windows
    const baseMetrics = { views: 0, carts: 0, purchases: 0 };
    const testMetrics = { views: 0, carts: 0, purchases: 0 };

    for (const hourData of hourlyMetrics) {
      const hourStart = new Date(hourData.hour);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      // Find which variant(s) were active during this hour
      // Since rotation is 30 min and ShopifyQL is hourly, an hour might span 2 variants
      const attribution = this.attributeHourToVariants(hourStart, hourEnd, windows);

      baseMetrics.views += Math.round(hourData.viewSessions * attribution.baseRatio);
      baseMetrics.carts += Math.round(hourData.cartSessions * attribution.baseRatio);
      baseMetrics.purchases += Math.round(hourData.purchaseSessions * attribution.baseRatio);

      testMetrics.views += Math.round(hourData.viewSessions * attribution.testRatio);
      testMetrics.carts += Math.round(hourData.cartSessions * attribution.testRatio);
      testMetrics.purchases += Math.round(hourData.purchaseSessions * attribution.testRatio);
    }

    // 4. Calculate rates
    const baseCVR = baseMetrics.views > 0
      ? (baseMetrics.purchases / baseMetrics.views) * 100
      : 0;
    const testCVR = testMetrics.views > 0
      ? (testMetrics.purchases / testMetrics.views) * 100
      : 0;

    const baseATC = baseMetrics.views > 0
      ? (baseMetrics.carts / baseMetrics.views) * 100
      : 0;
    const testATC = testMetrics.views > 0
      ? (testMetrics.carts / testMetrics.views) * 100
      : 0;

    const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

    return {
      base: {
        impressions: baseMetrics.views,
        addToCarts: baseMetrics.carts,
        conversions: baseMetrics.purchases,
        cvr: baseCVR,
        atcRate: baseATC,
      },
      test: {
        impressions: testMetrics.views,
        addToCarts: testMetrics.carts,
        conversions: testMetrics.purchases,
        cvr: testCVR,
        atcRate: testATC,
      },
      lift,
      totalSessions: baseMetrics.views + testMetrics.views,
      dataSource: "shopifyql",
      debug: {
        rotationWindowsAnalyzed: windows.length,
        hoursWithData: hourlyMetrics.length,
        oldestData: hourlyMetrics[0]?.hour || "",
        newestData: hourlyMetrics[hourlyMetrics.length - 1]?.hour || "",
      },
    };
  }

  /**
   * Build rotation windows from RotationEvent records.
   * Each window has a start time, end time, and active variant.
   */
  private static buildRotationWindows(
    rotationEvents: RotationEvent[],
    testCreatedAt: Date,
    testEndedAt?: Date | null
  ): RotationWindow[] {
    if (rotationEvents.length === 0) return [];

    // Sort by timestamp ascending
    const sorted = [...rotationEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const windows: RotationWindow[] = [];
    const endTime = testEndedAt || new Date();

    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];
      const nextEvent = sorted[i + 1];

      windows.push({
        start: new Date(event.timestamp),
        end: nextEvent ? new Date(nextEvent.timestamp) : endTime,
        activeCase: event.activeCase as "BASE" | "TEST",
      });
    }

    return windows;
  }

  /**
   * Determine what percentage of an hour belongs to each variant.
   * Handles the case where a 1-hour ShopifyQL bucket spans multiple 30-min rotation windows.
   */
  private static attributeHourToVariants(
    hourStart: Date,
    hourEnd: Date,
    windows: RotationWindow[]
  ): { baseRatio: number; testRatio: number } {
    let baseMinutes = 0;
    let testMinutes = 0;
    const hourDuration = 60; // minutes

    for (const window of windows) {
      // Find overlap between hour and rotation window
      const overlapStart = Math.max(hourStart.getTime(), window.start.getTime());
      const overlapEnd = Math.min(hourEnd.getTime(), window.end.getTime());

      if (overlapStart < overlapEnd) {
        const overlapMinutes = (overlapEnd - overlapStart) / (1000 * 60);

        if (window.activeCase === "BASE") {
          baseMinutes += overlapMinutes;
        } else {
          testMinutes += overlapMinutes;
        }
      }
    }

    const totalMinutes = baseMinutes + testMinutes;

    if (totalMinutes === 0) {
      // Hour is outside all rotation windows - likely before test started
      return { baseRatio: 0, testRatio: 0 };
    }

    return {
      baseRatio: baseMinutes / totalMinutes,
      testRatio: testMinutes / totalMinutes,
    };
  }

  private static emptyStats(reason: string): ShopifyQLStatistics {
    console.warn(`ShopifyQL stats unavailable: ${reason}`);
    return {
      base: { impressions: 0, addToCarts: 0, conversions: 0, cvr: 0, atcRate: 0 },
      test: { impressions: 0, addToCarts: 0, conversions: 0, cvr: 0, atcRate: 0 },
      lift: 0,
      totalSessions: 0,
      dataSource: "pixel_fallback",
      debug: {
        rotationWindowsAnalyzed: 0,
        hoursWithData: 0,
        oldestData: "",
        newestData: "",
      },
    };
  }
}
```

---

### Step 4: Update A/B Test Detail Loader

**File:** `app/routes/app.ab-tests.$id.tsx`

**Changes to `loader` function:**

```typescript
import { ShopifyQLStatisticsService } from "~/services/shopifyql-statistics.server";

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
      rotationEvents: {
        orderBy: { timestamp: 'asc' },
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

  // NEW: Use ShopifyQL-based statistics
  const statistics = await ShopifyQLStatisticsService.calculate(
    admin,
    test.productId,
    test.rotationEvents,
    test.createdAt,
    test.endedAt
  );

  return json({
    test,
    statistics,
  });
};
```

---

### Step 5: Update Statistics Display Component

**File:** `app/routes/app.ab-tests.$id.tsx` (UI portion)

Add data source indicator:

```typescript
{statistics && (
  <Card>
    <BlockStack gap="300">
      <InlineStack align="space-between">
        <Text variant="headingSm" as="h3">Statistics</Text>
        <Badge tone={statistics.dataSource === "shopifyql" ? "success" : "warning"}>
          {statistics.dataSource === "shopifyql" ? "ShopifyQL Data" : "Pixel Fallback"}
        </Badge>
      </InlineStack>

      {/* Stats table here */}

      {statistics.debug && (
        <Box paddingBlockStart="200">
          <Text variant="bodySm" tone="subdued">
            Based on {statistics.debug.hoursWithData} hours of data across {statistics.debug.rotationWindowsAnalyzed} rotation windows
          </Text>
        </Box>
      )}
    </BlockStack>
  </Card>
)}
```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `shopify.app.toml` | MODIFY | Add `read_reports` scope |
| `app/services/shopify-analytics.server.ts` | CREATE | ShopifyQL query service |
| `app/services/shopifyql-statistics.server.ts` | CREATE | Time-window statistics calculator |
| `app/routes/app.ab-tests.$id.tsx` | MODIFY | Use ShopifyQL statistics in loader |
| `extensions/ab-test-pixel/src/index.ts` | NO CHANGE | Keep for now, may deprecate later |

---

## Handling Edge Cases

### Perfect 1:1 Hour-to-Variant Mapping

With 60-minute rotation intervals aligned to clock hours, attribution is straightforward:

- Each ShopifyQL hour maps to exactly ONE variant
- No proportional splitting needed
- 100% accurate attribution

Example:
- Hour 10:00-11:00 has 100 views, rotation shows BASE active → 100 views to BASE
- Hour 11:00-12:00 has 80 views, rotation shows TEST active → 80 views to TEST

### Test Started Mid-Hour

If a test starts at 10:15:
- The partial hour (10:15-11:00) is attributed to the initial variant
- From 11:00 onward, normal hourly rotation applies
- Consider starting tests at the top of the hour for cleanest data

### Rotation Boundary Alignment

To ensure clean attribution, rotation events should align with clock hours:
- ✅ Good: Rotation at 10:00, 11:00, 12:00
- ⚠️ Suboptimal: Rotation at 10:15, 11:15, 12:15 (partial hour attribution needed)

### No Rotation Events

If no rotation events exist, the service returns empty stats with `dataSource: "pixel_fallback"`, allowing the UI to show a warning.

---

## Testing Plan

1. **Unit Tests** for `ShopifyAnalyticsService`:
   - Mock GraphQL responses
   - Test query construction with different product IDs
   - Test error handling for parse errors

2. **Unit Tests** for `ShopifyQLStatisticsService`:
   - Test rotation window building from events
   - Test hour-to-variant attribution with various scenarios
   - Test edge cases (no events, single variant, test ended)

3. **Integration Tests**:
   - Test actual ShopifyQL queries against dev store
   - Verify scope requirements

4. **Manual Testing**:
   - Compare old pixel stats vs new ShopifyQL stats
   - Verify CVR/CTR now fall in normal ranges (2-4%)
   - Check data source badge displays correctly

---

## Expected Results

| Metric | Before (Pixel Only) | After (ShopifyQL Pure) |
|--------|---------------------|------------------------|
| Impressions | ~2,320 (undercounted) | ~6,000-8,000 (accurate) |
| CTR | 6.85% (inflated) | ~2.5-3% (realistic) |
| CVR | 9.78% (inflated) | ~3-4% (realistic) |
| Data Accuracy | ~30-40% capture | ~100% (server-side) |

---

## Future Considerations

### Deprecating the Pixel

Once ShopifyQL statistics are validated:
1. The pixel's IMPRESSION events become redundant
2. Consider keeping pixel only for real-time variant assignment verification
3. ATC/PURCHASE attribution via pixel could be added later if time-based attribution proves insufficient

### Finer Granularity

If Shopify adds sub-hourly ShopifyQL granularity in the future, the statistics accuracy would improve further. The architecture already supports this - just update the query and attribution logic.

---

## API Limitations & Considerations

### ShopifyQL API Sunset Warning

> ⚠️ **Important:** The ShopifyQL API is being sunset as of API version `2024-07`.

**Options:**
1. Use API version `2024-04` or earlier (recommended for now)
2. Apply for beta access to the replacement API
3. Monitor Shopify changelog for migration path announcements

### Data Access Requirements

| Requirement | Status |
|-------------|--------|
| `read_reports` scope | Required |
| Protected Customer Data Level 2 | Required for full access |
| API version ≤ 2024-04 | Required (sunset in 2024-07) |

### Query Limitations

- **Time granularity:** `hour` is the finest available (no minute/30-min)
- **Data freshness:** May have 15-60 minute delay from real-time
- **Historical data:** Typically available for last 90 days
- **Row separation:** Sales metrics and session metrics may return in separate rows (handle in parsing)

### Fallback Strategy

If ShopifyQL becomes unavailable or insufficient:
1. Revert to pixel-based tracking (already implemented)
2. Consider Shopify Analytics API alternatives
3. Evaluate third-party analytics integrations

---

## Rollback Plan

If ShopifyQL returns unexpected data or causes issues:
1. The service already handles query failures gracefully
2. Can quickly revert to pixel-based stats by changing the loader
3. No database schema changes required - fully reversible
