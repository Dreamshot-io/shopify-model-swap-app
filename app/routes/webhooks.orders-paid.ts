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
