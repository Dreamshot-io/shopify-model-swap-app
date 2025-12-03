import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';

interface AbAttributePayload {
	testId: string;
	variant: string;
	productId?: string;
	sessionId?: string;
	assignedAt?: string;
}

function parseAbAttribute(raw: unknown): AbAttributePayload | null {
	if (!raw || typeof raw !== 'string') {
		return null;
	}

	try {
		const parsed = JSON.parse(raw);

		if (
			parsed &&
			typeof parsed === 'object' &&
			typeof parsed.testId === 'string' &&
			typeof parsed.variant === 'string'
		) {
			return {
				testId: parsed.testId,
				variant: parsed.variant,
				productId: typeof parsed.productId === 'string' ? parsed.productId : undefined,
				sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
				assignedAt: typeof parsed.assignedAt === 'string' ? parsed.assignedAt : undefined,
			} satisfies AbAttributePayload;
		}

		return null;
	} catch (error) {
		console.error('[orders-paid] Failed to parse AB attribute', error);
		return null;
	}
}

function normalizeVariantId(variantId: string | null | undefined): string | null {
	if (!variantId) return null;
	if (variantId.startsWith('gid://shopify/ProductVariant/')) {
		return variantId;
	}
	if (/^\d+$/.test(String(variantId))) {
		return `gid://shopify/ProductVariant/${variantId}`;
	}
	return String(variantId);
}

export const action = async ({ request }: ActionFunctionArgs) => {
	let topic: string;
	let shop: string;
	let payload: Record<string, unknown>;

	const shopHeader = request.headers.get('X-Shopify-Shop-Domain');
	console.log('[orders-paid] Webhook received', { shopHeader });

	// Dev bypass for testing - skip HMAC validation
	if (process.env.NODE_ENV !== 'production' && request.headers.get('X-Shopify-Hmac-Sha256') === 'test') {
		topic = request.headers.get('X-Shopify-Topic') || 'orders/paid';
		shop = request.headers.get('X-Shopify-Shop-Domain') || '';
		payload = await request.json();
		console.log('[orders-paid] DEV MODE: Bypassing HMAC validation');
	} else {
		const auth = await authenticate.webhook(request);
		topic = auth.topic;
		shop = auth.shop;
		payload = auth.payload as Record<string, unknown>;
		console.log('[orders-paid] Authenticated', { topic, shop });
	}

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

		// Try to find matching test if no meta from order attributes
		if (!meta && lineItems.length > 0) {
			const firstLineItem = lineItems[0] as Record<string, unknown> | undefined;
			const lineItemProductId = firstLineItem?.product_id
				? normalizeProductId(String(firstLineItem.product_id))
				: null;

			if (lineItemProductId) {
				// Look for ACTIVE test for this product (only assign events to active tests)
				const matchingTest = await db.aBTest.findFirst({
					where: {
						productId: lineItemProductId,
						shop,
						status: 'ACTIVE',
					},
					orderBy: { createdAt: 'desc' },
					select: {
						id: true,
						productId: true,
						currentCase: true,
						status: true,
					},
				});

				if (matchingTest) {
					meta = {
						testId: matchingTest.id,
						variant: matchingTest.currentCase === 'TEST' ? 'TEST' : 'BASE',
						productId: matchingTest.productId,
						sessionId: undefined,
					};
					console.log('[orders-paid] Found active test for product', {
						testId: matchingTest.id,
						status: matchingTest.status,
						productId: lineItemProductId,
					});
				} else {
					// No active test - still record the purchase without test association
					meta = {
						testId: '', // Will be set to null below
						variant: 'BASE',
						productId: lineItemProductId,
						sessionId: undefined,
					};
					console.log('[orders-paid] No active test found, recording purchase without test', {
						productId: lineItemProductId,
						orderId,
					});
				}
			}
		}

		// Still no meta and no line items - nothing to track
		if (!meta) {
			console.log('[orders-paid] No trackable data on order', {
				orderId,
				shop,
				lineItemCount: lineItems.length,
			});
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

		// Look up test if we have a testId (already filtered to ACTIVE in earlier lookup)
		let test = null;
		if (meta.testId) {
			test = await db.aBTest.findFirst({
				where: {
					id: meta.testId,
					shop,
				},
				select: {
					id: true,
					productId: true,
					status: true,
				},
			});

			if (!test) {
				console.log('[orders-paid] Test not found, recording without test association', {
					testId: meta.testId,
					shop,
					orderId,
				});
			}
		}

		const sessionId = meta.sessionId || `order:${orderId || 'unknown'}`;
		const productId = meta.productId || test?.productId || null;

		if (!productId) {
			console.warn('[orders-paid] No productId available', { orderId, shop });
			return json({ ok: true });
		}

		// Use test.id if found, otherwise null (no test association)
		const testIdForEvent = test?.id || null;

		// Resolve shopId from shop domain
		let shopId: string | null = null;
		if (shop) {
			const shopCredential = await db.shopCredential.findFirst({
				where: { shopDomain: shop },
				select: { id: true },
			});
			shopId = shopCredential?.id || null;
		}

		const activeCase = meta.variant === 'B' || meta.variant === 'TEST' ? 'TEST' : 'BASE';

		const firstLineItem = lineItems[0] as Record<string, unknown> | undefined;
		const variantId = firstLineItem?.variant_id ? normalizeVariantId(String(firstLineItem.variant_id)) : null;

		// Check if pixel already created a PURCHASE event for this orderId
		// Pixel fires checkout_completed immediately, webhook fires ~3s later
		// Strategy: UPDATE existing pixel event with revenue data, don't create duplicate
		const existingPixelPurchase = orderId
			? await db.aBTestEvent.findFirst({
					where: {
						eventType: 'PURCHASE',
						metadata: {
							path: ['orderId'],
							equals: orderId,
						},
					},
					select: {
						id: true,
						sessionId: true,
						revenue: true,
						metadata: true,
					},
				})
			: null;

		if (existingPixelPurchase) {
			// Enrich existing pixel event with webhook data (revenue, quantity, order details)
			const existingMetadata = (existingPixelPurchase.metadata as Record<string, unknown>) || {};
			const orderNumber = order.order_number ? String(order.order_number) : null;

			await db.aBTestEvent.update({
				where: { id: existingPixelPurchase.id },
				data: {
					revenue: revenue > 0 ? revenue : existingPixelPurchase.revenue,
					quantity: totalQuantity > 0 ? totalQuantity : null,
					// Update testId and activeCase if we found an active test and pixel didn't have one
					...(testIdForEvent && !existingMetadata.testId
						? { testId: testIdForEvent, activeCase }
						: {}),
					metadata: {
						...existingMetadata,
						orderNumber: orderNumber ?? (existingMetadata.orderNumber as string | null),
						lineItemCount: lineItems.length,
						enrichedByWebhook: true,
						webhookReceivedAt: new Date().toISOString(),
					},
				},
			});

			console.log('[orders-paid] Enriched existing pixel purchase with webhook data', {
				eventId: existingPixelPurchase.id,
				orderId,
				revenue,
				quantity: totalQuantity,
				testId: testIdForEvent,
			});

			return json({ ok: true });
		}

		// No pixel event exists - this can happen if:
		// 1. Pixel didn't fire (ad blocker, page closed before checkout_completed)
		// 2. Order placed via different channel (POS, draft order, API)
		// Create a new webhook-sourced event as fallback
		await db.aBTestEvent.create({
			data: {
				testId: testIdForEvent,
				sessionId,
				eventType: 'PURCHASE',
				activeCase: testIdForEvent ? activeCase : null,
				productId,
				variantId,
				shopId,
				revenue: revenue > 0 ? revenue : null,
				quantity: totalQuantity > 0 ? totalQuantity : null,
				metadata: {
					orderId,
					orderNumber: order.order_number ? String(order.order_number) : null,
					lineItemCount: lineItems.length,
					source: 'webhook',
					hasTest: !!testIdForEvent,
				},
			},
		});

		console.log('[orders-paid] Created new purchase event (no pixel event found)', {
			testId: testIdForEvent,
			sessionId,
			activeCase: testIdForEvent ? activeCase : null,
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

function normalizeProductId(productId: string | null | undefined): string | null {
	if (!productId) return null;
	if (productId.startsWith('gid://shopify/Product/')) {
		return productId;
	}
	if (/^\d+$/.test(String(productId))) {
		return `gid://shopify/Product/${productId}`;
	}
	return String(productId);
}
