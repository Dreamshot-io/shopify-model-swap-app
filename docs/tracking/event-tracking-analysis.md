# Event Tracking System Analysis

## Overview

Analysis of how impressions, Add to Cart, and order/paid webhooks are recorded in the A/B testing system.

## Architecture: Single Event Recording System

**Answer: NO double system** - Events are recorded once in `ABTestEvent` table, statistics calculated on-the-fly.

### Event Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    EVENT SOURCES                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. WEB PIXEL (extensions/ab-test-pixel/src/index.ts)      │
│     ├─ IMPRESSION: product_viewed event                     │
│     ├─ ADD_TO_CART: product_added_to_cart event            │
│     └─ PURCHASE: checkout_completed event                   │
│                                                              │
│  2. WEBHOOK (app/routes/webhooks.orders-paid.ts)          │
│     └─ PURCHASE: orders/paid webhook                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                        ↓
        POST /track (app/routes/track.tsx)
                        ↓
        ┌───────────────────────────────┐
        │   ABTestEvent Table            │
        │   (prisma/schema.prisma)      │
        └───────────────────────────────┘
                        ↓
        Statistics calculated on-the-fly
        (app/routes/app.ab-tests.$id.tsx)
```

## Database Storage

### Table: `ABTestEvent`

```119:142:prisma/schema.prisma
// Customer event tracking (impressions, conversions, purchases)
model ABTestEvent {
  id         String @id @default(cuid())
  testId     String
  sessionId  String
  eventType  String // IMPRESSION, ADD_TO_CART, PURCHASE
  activeCase String // BASE or TEST (what was showing when event occurred)

  // Event details
  productId String
  variantId String? // Shopify variant ID if applicable
  revenue   Decimal? // For PURCHASE events
  quantity  Int? // For ADD_TO_CART and PURCHASE events

  // Context
  metadata  Json? // JSON with additional context (browser, referrer, etc.)
  createdAt DateTime @default(now())

  test ABTest @relation(fields: [testId], references: [id], onDelete: Cascade)

  @@index([testId, eventType, createdAt])
  @@index([testId, sessionId])
  @@index([testId, activeCase])
}
```

**Storage Location**: Single table, no separate totalization table.

## Event Recording Details

### 1. IMPRESSION Events

**Source**: Web Pixel - `product_viewed` event

**Flow**:
```36:48:extensions/ab-test-pixel/src/index.ts
  // Track product views
  analytics.subscribe('product_viewed', async event => {
    const productId = event.data?.product?.id;
    const variantId = event.data?.productVariant?.id ?? event.data?.productVariantId ?? null;

    log('Product viewed', { productId, variantId });

    if (!productId) {
      log('No productId, skipping');
      return;
    }

    await fetchAndStoreTestState(productId, variantId);
  });
```

**Deduplication**:
- Client-side: `sessionStorage` prevents duplicate impressions per test/case
- Server-side: Duplicate check in `/track` endpoint

```175:203:app/routes/track.tsx
    // Check for duplicate events (only for impressions to prevent double-counting)
    if (eventType === 'IMPRESSION') {
      const duplicateEvent = await db.aBTestEvent.findFirst({
        where: {
          testId,
          sessionId,
          eventType,
          productId,
        },
      });

      if (duplicateEvent) {
        // Log duplicate detection (sampled to avoid spam)
        if (Math.random() < 0.01) {
          console.log('[Track API] Duplicate impression detected and skipped', {
            testId,
            sessionId,
            productId,
            existingEventId: duplicateEvent.id,
            shop: shopDomain,
          });
        }

        return json(
          { success: true, message: 'Event already tracked', eventId: duplicateEvent.id },
          { headers: corsHeaders },
        );
      }
    }
```

### 2. ADD_TO_CART Events

**Source**: Web Pixel - `product_added_to_cart` event

**Flow**:
```50:88:extensions/ab-test-pixel/src/index.ts
  // Track add to cart events
  analytics.subscribe('product_added_to_cart', async event => {
    let state = getTestState();

    // Recovery: If state is missing, try to fetch it from the event data
    if (!state) {
      const productId = event.data?.cartLine?.merchandise?.product?.id ??
                       event.data?.product?.id ??
                       null;

      if (productId) {
        log('Add-to-cart: Missing test state, attempting recovery for product', productId);
        const variantId = event.data?.cartLine?.merchandise?.id ?? null;
        await fetchAndStoreTestState(productId, variantId);
        state = getTestState();

        if (!state) {
          console.warn('[A/B Test Pixel] Add-to-cart: Could not recover test state for product', productId);
          return;
        }
        log('Add-to-cart: Successfully recovered test state', state);
      } else {
        console.warn('[A/B Test Pixel] Add-to-cart: Missing test state and productId, skipping tracking');
        return;
      }
    }

    const variantId = event.data?.cartLine?.merchandise?.id ?? null;
    const quantity = event.data?.cartLine?.quantity ?? 1;

    await trackEvent(state, 'ADD_TO_CART', {
      variantId,
      quantity,
      metadata: {
        price: event.data?.cartLine?.cost?.totalAmount?.amount,
        currency: event.data?.cartLine?.cost?.totalAmount?.currencyCode,
      },
    });
  });
```

**Deduplication**: **NO** - Every add-to-cart is tracked (multiple adds in same session = multiple events)

### 3. PURCHASE Events

**Two Sources** with **coordinated deduplication**:

#### Purchase Flow (Updated December 2024)

```
Customer completes checkout
        ↓
┌───────────────────────────────────────────────────────────────┐
│  1. PIXEL (immediate)                                         │
│     checkout_completed event fires                            │
│     → Creates PURCHASE event with orderId in metadata         │
│     → Revenue is NULL (Shopify doesn't provide it to pixel)   │
│     → Session ID: session_xxxx                                │
└───────────────────────────────────────────────────────────────┘
        ↓ (~3 seconds later)
┌───────────────────────────────────────────────────────────────┐
│  2. WEBHOOK (delayed)                                         │
│     orders/paid webhook fires                                 │
│     → Checks if PURCHASE exists with same orderId             │
│     → If EXISTS: UPDATE with revenue, quantity, order details │
│     → If NOT EXISTS: CREATE new event (fallback)              │
└───────────────────────────────────────────────────────────────┘
```

#### A. Web Pixel - `checkout_completed`

The pixel tracks purchases immediately when checkout completes:
- Creates event with `sessionId: session_xxxx`
- Stores `orderId` in metadata for deduplication
- **Revenue is always NULL** (Shopify doesn't provide cost data to pixel)
- Currency is available in metadata

**Deduplication**: Track endpoint checks for existing PURCHASE with same `orderId` before creating.

#### B. Webhook - `orders/paid`

```55:235:app/routes/webhooks.orders-paid.ts
export const action = async ({ request }: ActionFunctionArgs) => {
	const { topic, shop, payload } = await authenticate.webhook(request);

	if (!payload || typeof payload !== 'object') {
		console.warn('[orders-paid] Missing payload', { topic, shop });
		return json({ ok: true });
	}

	try {
		const order = payload as Record<string, unknown>;
		const orderId = order.id ? String(order.id) : null;
		const attributes = Array.isArray(order.note_attributes)
			? (order.note_attributes as Array<Record<string, unknown>>)
			: [];

		const abAttribute = attributes.find(attr => attr?.name === 'ModelSwapAB');
		let meta = parseAbAttribute(abAttribute?.value);

		const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];

		if (!meta && lineItems.length > 0) {
			const firstLineItem = lineItems[0] as Record<string, unknown> | undefined;
			const lineItemProductId = firstLineItem?.product_id
				? normalizeProductId(String(firstLineItem.product_id))
				: null;

			if (lineItemProductId) {
				const matchingTest = await db.aBTest.findFirst({
					where: {
						productId: lineItemProductId,
						shop,
						status: {
							in: ['ACTIVE', 'PAUSED'],
						},
					},
					select: {
						id: true,
						productId: true,
						currentCase: true,
					},
				});

				if (matchingTest) {
					meta = {
						testId: matchingTest.id,
						variant: matchingTest.currentCase === 'TEST' ? 'TEST' : 'BASE',
						productId: matchingTest.productId,
						sessionId: undefined,
					};
				}
			}
		}

		if (!meta) {
			if (Math.random() < 0.01) {
				console.log('[orders-paid] No A/B metadata on order (sampled log)', {
					orderId,
					shop,
					lineItemCount: lineItems.length,
				});
			}
			return json({ ok: true });
		}

		const revenue = lineItems.reduce((acc, item) => {
			if (item && typeof item === 'object') {
				const price = Number((item as Record<string, unknown>).price ?? 0);
				const quantity = Number((item as Record<string, unknown>).quantity ?? 0);

				if (!Number.isNaN(price) && !Number.isNaN(quantity)) {
					return acc + price * quantity;
				}
			}

			return acc;
		}, 0);

		const totalQuantity = lineItems.reduce((acc, item) => {
			if (item && typeof item === 'object') {
				const quantity = Number((item as Record<string, unknown>).quantity ?? 0);
				if (!Number.isNaN(quantity)) {
					return acc + quantity;
				}
			}

			return acc;
		}, 0);

		const test = await db.aBTest.findFirst({
			where: {
				id: meta.testId,
				shop,
				status: {
					in: ['ACTIVE', 'PAUSED'],
				},
			},
			select: {
				id: true,
				productId: true,
			},
		});

		if (!test) {
			console.warn('[orders-paid] AB test not found or not active', {
				testId: meta.testId,
				shop,
				orderId,
			});
			return json({ ok: true });
		}

		const sessionId = meta.sessionId || `order:${orderId || 'unknown'}`;
		const productId = meta.productId || test.productId;

		const duplicate = await db.aBTestEvent.findFirst({
			where: {
				testId: meta.testId,
				sessionId,
				eventType: 'PURCHASE',
				productId,
			},
			select: {
				id: true,
			},
		});

		if (duplicate) {
			if (Math.random() < 0.05) {
				console.log('[orders-paid] Purchase already recorded (sampled log)', {
					testId: meta.testId,
					sessionId,
					productId,
				});
			}
			return json({ ok: true });
		}

		const activeCase = meta.variant === 'B' || meta.variant === 'TEST' ? 'TEST' : 'BASE';

		const firstLineItem = lineItems[0] as Record<string, unknown> | undefined;
		const variantId = firstLineItem?.variant_id ? normalizeVariantId(String(firstLineItem.variant_id)) : null;

		await db.aBTestEvent.create({
			data: {
				testId: meta.testId,
				sessionId,
				eventType: 'PURCHASE',
				activeCase,
				productId,
				variantId,
				revenue: revenue > 0 ? revenue : null,
				quantity: totalQuantity > 0 ? totalQuantity : null,
				metadata: {
					orderId,
					orderNumber: order.order_number ? String(order.order_number) : null,
					lineItemCount: lineItems.length,
					source: 'webhook',
				},
			},
		});

		console.log('[orders-paid] Purchase event recorded', {
			testId: meta.testId,
			sessionId,
			activeCase,
			productId,
			revenue,
			quantity: totalQuantity,
			orderId,
		});

		return json({ ok: true });
	} catch (error) {
		console.error('[orders-paid] Handler failed', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			shop,
			orderId: (payload as Record<string, unknown>)?.id,
		});
		return json({ ok: false }, { status: 500 });
	}
};
```

**Deduplication Strategy (Updated December 2024)**:

The webhook now uses `orderId` as the primary deduplication key:

1. **Check** if PURCHASE event exists with same `orderId` in metadata
2. **If EXISTS**: UPDATE the pixel event with revenue, quantity, and order details
3. **If NOT EXISTS**: CREATE new event as fallback (for orders without pixel tracking)

This ensures:
- Only ONE purchase event per order
- Pixel event gets enriched with webhook data (revenue)
- Orders from non-pixel sources (POS, API, draft orders) still get tracked

## Statistics Calculation

**No Totalization Table** - Statistics calculated on-the-fly from events.

### Calculation Location

```55:106:app/routes/app.ab-tests.$id.tsx
  // Calculate statistics
  const baseEvents = test.events.filter(e => e.activeCase === 'BASE');
  const testEvents = test.events.filter(e => e.activeCase === 'TEST');

  const baseImpressions = baseEvents.filter(e => e.eventType === 'IMPRESSION').length;
  const testImpressions = testEvents.filter(e => e.eventType === 'IMPRESSION').length;

  const baseAddToCarts = baseEvents.filter(e => e.eventType === 'ADD_TO_CART').length;
  const testAddToCarts = testEvents.filter(e => e.eventType === 'ADD_TO_CART').length;

  const baseConversions = baseEvents.filter(e => e.eventType === 'PURCHASE').length;
  const testConversions = testEvents.filter(e => e.eventType === 'PURCHASE').length;

  const baseRevenue = baseEvents
    .filter(e => e.eventType === 'PURCHASE' && e.revenue)
    .reduce((sum, e) => sum + Number(e.revenue), 0);

  const testRevenue = testEvents
    .filter(e => e.eventType === 'PURCHASE' && e.revenue)
    .reduce((sum, e) => sum + Number(e.revenue), 0);

  const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
  const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;

  const baseATC = baseImpressions > 0 ? (baseAddToCarts / baseImpressions) * 100 : 0;
  const testATC = testImpressions > 0 ? (testAddToCarts / testImpressions) * 100 : 0;

  const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

  return json({
    test,
    statistics: {
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
      totalSessions: new Set(test.events.map(e => e.sessionId)).size,
    },
  });
```

**Performance**: Loads up to 1000 events per test (line 38: `take: 1000`), recalculates on every page load.

## Issues Preventing Recording

### 1. ✅ PURCHASE Event Double-Tracking (FIXED December 2024)

**Problem**: Both pixel and webhook were creating PURCHASE events for same order.

**Root Cause**:
- Pixel uses actual `sessionId` from localStorage
- Webhook uses `order:${orderId}` as sessionId
- Old duplicate check in webhook only matched on `sessionId`

**Solution Implemented**:
- Track endpoint: Deduplicates by `orderId` in metadata before creating PURCHASE
- Webhook: Checks for existing PURCHASE with same `orderId`, UPDATES instead of CREATE
- Webhook enriches pixel event with revenue data (pixel doesn't receive revenue from Shopify)

**Result**: One PURCHASE event per order with complete data (session from pixel + revenue from webhook)

### 2. ⚠️ Missing Test State Recovery

**Problem**: If pixel loses state (sessionStorage cleared), ADD_TO_CART/PURCHASE events may not be tracked.

**Current Recovery**: Only ADD_TO_CART has recovery logic, PURCHASE doesn't.

```54:75:extensions/ab-test-pixel/src/index.ts
    // Recovery: If state is missing, try to fetch it from the event data
    if (!state) {
      const productId = event.data?.cartLine?.merchandise?.product?.id ??
                       event.data?.product?.id ??
                       null;

      if (productId) {
        log('Add-to-cart: Missing test state, attempting recovery for product', productId);
        const variantId = event.data?.cartLine?.merchandise?.id ?? null;
        await fetchAndStoreTestState(productId, variantId);
        state = getTestState();

        if (!state) {
          console.warn('[A/B Test Pixel] Add-to-cart: Could not recover test state for product', productId);
          return;
        }
        log('Add-to-cart: Successfully recovered test state', state);
      } else {
        console.warn('[A/B Test Pixel] Add-to-cart: Missing test state and productId, skipping tracking');
        return;
      }
    }
```

**Fix Needed**: Add recovery logic to PURCHASE tracking in pixel.

### 3. ⚠️ Performance: No Caching

**Problem**: Statistics recalculated on every page load, loading up to 1000 events.

**Impact**: Slow page loads for tests with many events

**Fix Needed**:
- Cache statistics in test record
- Update cache on event creation
- Or: Use database aggregation queries instead of loading all events

### 4. ⚠️ Webhook Metadata Dependency

**Problem**: Webhook relies on `ModelSwapAB` note attribute or falls back to matching by productId.

```70:106:app/routes/webhooks.orders-paid.ts
		const abAttribute = attributes.find(attr => attr?.name === 'ModelSwapAB');
		let meta = parseAbAttribute(abAttribute?.value);

		const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];

		if (!meta && lineItems.length > 0) {
			const firstLineItem = lineItems[0] as Record<string, unknown> | undefined;
			const lineItemProductId = firstLineItem?.product_id
				? normalizeProductId(String(firstLineItem.product_id))
				: null;

			if (lineItemProductId) {
				const matchingTest = await db.aBTest.findFirst({
					where: {
						productId: lineItemProductId,
						shop,
						status: {
							in: ['ACTIVE', 'PAUSED'],
						},
					},
					select: {
						id: true,
						productId: true,
						currentCase: true,
					},
				});

				if (matchingTest) {
					meta = {
						testId: matchingTest.id,
						variant: matchingTest.currentCase === 'TEST' ? 'TEST' : 'BASE',
						productId: matchingTest.productId,
						sessionId: undefined,
					};
				}
			}
		}
```

**Issue**: If note attribute missing AND productId doesn't match (e.g., variant product), purchase not tracked.

## ⚠️ CRITICAL: Tracking May Not Be Active

**If you're visiting product pages and seeing zero events, the pixel is likely not connected or configured.**

### Quick Check:
1. **Open browser DevTools (F12) → Console**
2. **Visit a product page**
3. **Look for `[A/B Test Pixel]` logs**

**If NO logs appear:**
- Pixel not connected → Visit `/app/connect-pixel` to connect
- Pixel not configured → Missing `app_url` setting
- See `docs/tracking/tracking-troubleshooting-guide.md` for full diagnosis

**If logs appear but no events:**
- Check `app_url` setting (must be absolute URL)
- Verify test exists and is ACTIVE
- Check network tab for failed API calls

## Summary

| Aspect | Status | Details |
|--------|--------|---------|
| **Double System** | ❌ NO | Single event table, stats calculated on-the-fly |
| **Event Storage** | ✅ `ABTestEvent` table | All events stored here |
| **Statistics Storage** | ❌ Calculated on-demand | No cached totals |
| **IMPRESSION Deduplication** | ✅ YES | Client + server checks |
| **ADD_TO_CART Deduplication** | ❌ NO | Intentionally tracks all |
| **PURCHASE Deduplication** | ✅ YES (Dec 2024) | orderId-based dedup in track endpoint + webhook enrichment |
| **Performance** | ⚠️ SLOW | Loads 1000 events per page load |
| **Pixel Connection** | ⚠️ REQUIRES SETUP | Must be connected + configured |

## Purchase Event Flow (Updated December 2024)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PURCHASE TRACKING FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Checkout Complete                                               │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────────────────────┐                            │
│  │ PIXEL: checkout_completed        │                            │
│  │ - Creates PURCHASE event         │                            │
│  │ - sessionId: session_xxxx        │                            │
│  │ - orderId in metadata            │                            │
│  │ - revenue: NULL (not provided)   │                            │
│  └─────────────────────────────────┘                            │
│        │                                                         │
│        ▼ (~3 seconds)                                           │
│  ┌─────────────────────────────────┐                            │
│  │ WEBHOOK: orders/paid             │                            │
│  │ - Finds event by orderId         │                            │
│  │ - UPDATES (not creates):         │                            │
│  │   • revenue                      │                            │
│  │   • quantity                     │                            │
│  │   • orderNumber                  │                            │
│  │   • enrichedByWebhook: true      │                            │
│  └─────────────────────────────────┘                            │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────────────────────┐                            │
│  │ RESULT: Single complete event    │                            │
│  │ - Session from pixel             │                            │
│  │ - Revenue from webhook           │                            │
│  │ - No duplicates                  │                            │
│  └─────────────────────────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Fallback**: If pixel didn't fire (ad blocker, page closed), webhook creates new event with `order:` sessionId.

## Recommendations

1. ~~**Fix PURCHASE double-tracking**~~: ✅ DONE - orderId-based deduplication implemented
2. **Add PURCHASE recovery**: Add test state recovery to pixel PURCHASE handler
3. **Add statistics caching**: Store aggregated stats in test record, update on event creation
4. **Improve webhook reliability**: Better fallback logic for missing metadata
