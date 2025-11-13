import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { AuditService } from '../services/audit.server';
// import { trackingRateLimiter, applyRateLimit } from '../utils/rate-limiter';

/**
 * Handle OPTIONS preflight requests for CORS
 * In Remix, OPTIONS requests go to loader, not action
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
	if (request.method === 'OPTIONS') {
		return json(
			{},
			{
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
				},
			},
		);
	}

	// For non-OPTIONS GET requests, return method not allowed
	return json(
		{ error: 'Method not allowed. Use POST to track events.' },
		{
			status: 405,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		},
	);
};

/**
 * Track events from the web pixel (impressions, add-to-cart, purchases)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
	if (request.method !== 'POST') {
		return json(
			{ error: 'Method not allowed' },
			{
				status: 405,
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			},
		);
	}

	let corsHeaders: Record<string, string> = {};
	let shopDomain: string | undefined;

	// Check if this is a pixel request (no signature = direct browser call)
	const hasSignature =
		request.headers.get('x-shopify-hmac-sha256') || new URL(request.url).searchParams.has('signature');

	// Try app proxy authentication only if signature present (admin requests)
	// Pixel requests from storefront won't have signature, so skip auth
	if (hasSignature) {
		try {
			const { session, cors } = await authenticate.public.appProxy(request);
			shopDomain = session?.shop;
			corsHeaders = cors?.headers || {};
		} catch (error) {
			// If signature present but invalid, log but continue with public access
			console.warn('[track] App proxy auth failed, using public access', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	// Always set CORS headers for pixel requests (direct browser calls)
	if (!corsHeaders['Access-Control-Allow-Origin']) {
		corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
		};
	}

	try {
		const body = await request.json();

		// Log raw body for debugging
		console.log('[Track API] Raw request body:', JSON.stringify(body, null, 2));

		const { testId, sessionId, eventType, activeCase, revenue, quantity, productId, variantId, metadata } =
			body ?? {};

		// Validate and normalize sessionId
		let normalizedSessionId: string | null = null;
		if (typeof sessionId === 'string') {
			normalizedSessionId = sessionId;
		} else if (sessionId && typeof sessionId === 'object') {
			console.warn('[Track API] sessionId is an object, attempting to extract:', sessionId);
			// Try to extract string from object (shouldn't happen, but handle it)
			normalizedSessionId = String(sessionId);
		} else if (sessionId === null || sessionId === undefined) {
			console.warn('[Track API] sessionId is null/undefined');
		} else {
			console.warn('[Track API] sessionId has unexpected type:', typeof sessionId, sessionId);
			normalizedSessionId = String(sessionId);
		}

		// Validate required fields (testId and activeCase are now optional - server will find test)
		if (!normalizedSessionId || !eventType || !productId) {
			const missingFields = {
				hasSessionId: Boolean(normalizedSessionId),
				hasEventType: Boolean(eventType),
				hasProductId: Boolean(productId),
			};

			console.warn('[Track API] Missing required fields', {
				missingFields,
				receivedBody: {
					sessionId: { raw: sessionId, normalized: normalizedSessionId, type: typeof sessionId },
					eventType,
					productId,
				},
				shop: shopDomain,
			});

			await AuditService.logApiError(
				shopDomain || 'UNKNOWN',
				'/track',
				new Error(`Missing required fields: ${JSON.stringify(missingFields)}`),
			);

			return json(
				{
					error: 'Missing required fields',
					details: missingFields,
				},
				{
					status: 400,
					headers: {
						...corsHeaders,
						'Access-Control-Allow-Origin': '*',
					},
				},
			);
		}

		// Find active test for this product (server-side assignment)
		let assignedTestId: string | null = null;
		let assignedActiveCase: 'BASE' | 'TEST' | null = null;

		if (!testId || !activeCase) {
			// Server will find and assign test if active
			const { SimpleRotationService } = await import('../services/simple-rotation.server');
			const rotationState = await SimpleRotationService.getRotationState(productId);

			if (rotationState.testId && rotationState.activeCase) {
				assignedTestId = rotationState.testId;
				assignedActiveCase = rotationState.activeCase as 'BASE' | 'TEST';
				console.log('[Track API] ✅ Assigned test from server:', {
					productId,
					testId: assignedTestId,
					activeCase: assignedActiveCase,
				});
			} else {
				console.log('[Track API] ℹ️ No active test for product, tracking without test:', {
					productId,
					eventType,
				});
			}
		} else {
			// Use provided testId and activeCase (backward compatibility)
			assignedTestId = testId;
			assignedActiveCase = activeCase as 'BASE' | 'TEST';
		}

		// Validate event type
		const validEventTypes = ['IMPRESSION', 'ADD_TO_CART', 'PURCHASE'];
		if (!validEventTypes.includes(eventType)) {
			console.warn('[Track API] Invalid event type', {
				received: eventType,
				valid: validEventTypes,
				productId,
				shop: shopDomain,
			});

			return json(
				{ error: 'Invalid event type', received: eventType, valid: validEventTypes },
				{
					status: 400,
					headers: {
						...corsHeaders,
						'Access-Control-Allow-Origin': '*',
					},
				},
			);
		}

		// Validate active case if provided (optional now)
		if (assignedActiveCase) {
			const validCases = ['BASE', 'TEST'];
			if (!validCases.includes(assignedActiveCase)) {
				console.warn('[Track API] Invalid active case', {
					received: assignedActiveCase,
					valid: validCases,
					productId,
					eventType,
				});
				assignedActiveCase = null; // Reset if invalid
			}
		}

		// Verify test exists if assigned (optional - events can be tracked without test)
		let test = null;
		if (assignedTestId) {
			test = await db.aBTest.findFirst({
				where: shopDomain
					? {
							id: assignedTestId,
							shop: shopDomain,
						}
					: {
							id: assignedTestId,
						},
			});

			if (test) {
				// Use test's shop if we don't have it from auth
				shopDomain = shopDomain || test.shop;
			} else {
				console.warn('[Track API] Assigned test not found, tracking without test', {
					testId: assignedTestId,
					productId,
					eventType,
				});
				assignedTestId = null;
				assignedActiveCase = null;
			}
		}

		// Normalize variant ID if provided
		const normalizedVariantId = normalizeVariantId(variantId ?? null);

		// Simplified: No deduplication - track every impression
		// Deduplication can be added back later if needed

		// Create the event
		let createdEvent;
		try {
			// Use normalizedSessionId to ensure it's a string
			if (!normalizedSessionId) {
				throw new Error('sessionId is required but was null or invalid');
			}

			// Create event - testId and activeCase are optional (can be null if no active test)
			// Build data object conditionally - only include testId if assigned
			// This avoids Prisma requiring the test relation when testId is null
			const eventData: {
				testId?: string | null;
				sessionId: string;
				eventType: string;
				activeCase?: string | null;
				productId: string;
				variantId: string | null;
				revenue: number | null;
				quantity: number | null;
				metadata: any;
			} = {
				sessionId: normalizedSessionId,
				eventType,
				productId,
				variantId: normalizedVariantId,
				revenue: revenue ? Number.parseFloat(String(revenue)) : null,
				quantity: quantity ? Number.parseInt(String(quantity), 10) : null,
				metadata: metadata || {},
			};

			// Only include testId and activeCase if test is assigned
			// When omitted, Prisma won't require the test relation
			if (assignedTestId) {
				eventData.testId = assignedTestId;
				eventData.activeCase = assignedActiveCase;
			} else {
				// Explicitly set to null for events without test
				eventData.testId = null;
				eventData.activeCase = null;
			}

			createdEvent = await db.aBTestEvent.create({
				data: eventData,
			});

			if (assignedTestId) {
				console.log('[Track API] ✅ Event tracked with test:', {
					eventId: createdEvent.id,
					testId: assignedTestId,
					activeCase: assignedActiveCase,
					eventType,
				});
			} else {
				console.log('[Track API] ✅ Event tracked without test:', {
					eventId: createdEvent.id,
					productId,
					eventType,
				});
			}
		} catch (dbError) {
			console.error('[Track API] Database error creating event', {
				error: dbError,
				testId: assignedTestId,
				eventType,
				productId,
				shop: shopDomain,
			});

			await AuditService.logApiError(shopDomain || 'UNKNOWN', '/track', dbError as Error);

			return json(
				{ error: 'Failed to create event in database', details: (dbError as Error).message },
				{
					status: 500,
					headers: {
						...corsHeaders,
						'Access-Control-Allow-Origin': '*',
					},
				},
			);
		}

		// Log significant events (purchases always, others sampled)
		if (eventType === 'PURCHASE' || Math.random() < 0.1) {
			await AuditService.logUserAction(
				`CUSTOMER_${eventType}`,
				normalizedSessionId || 'unknown',
				shopDomain || 'UNKNOWN',
				{
					testId: assignedTestId,
					activeCase: assignedActiveCase,
					productId,
					variantId: normalizedVariantId,
					revenue,
				},
			);
		}

		// Log successful tracking (sampled for non-purchase events)
		if (eventType === 'PURCHASE' || Math.random() < 0.05) {
			console.log('[Track API] ✅ Event tracked successfully', {
				eventId: createdEvent.id,
				eventType,
				testId: assignedTestId,
				activeCase: assignedActiveCase,
				productId,
				sessionId: normalizedSessionId,
				shop: shopDomain,
			});
		}

		return json(
			{
				success: true,
				eventId: createdEvent.id,
				testId: assignedTestId,
				activeCase: assignedActiveCase,
				message: `${eventType} event tracked successfully`,
			},
			{ headers: corsHeaders },
		);
	} catch (error) {
		if (error instanceof Response) {
			return error;
		}

		const message = error instanceof Error ? error.message : 'Internal server error';

		// Enhanced error logging with context
		console.error('[Track API] Unexpected error', {
			error: message,
			stack: error instanceof Error ? error.stack : undefined,
			shop: shopDomain,
			url: request.url,
			method: request.method,
		});

		// Log tracking errors
		await AuditService.logApiError(shopDomain || 'UNKNOWN', '/track', error as Error);

		return json(
			{
				error: message,
				details:
					process.env.NODE_ENV === 'development'
						? error instanceof Error
							? error.stack
							: undefined
						: undefined,
			},
			{
				status: 500,
				headers: {
					...corsHeaders,
					'Access-Control-Allow-Origin': '*',
				},
			},
		);
	}
};

/**
 * Normalize variant ID to Shopify GID format
 */
export function normalizeVariantId(variantId: string | null): string | null {
	if (!variantId) return null;
	if (variantId.startsWith('gid://shopify/ProductVariant/')) {
		return variantId;
	}
	if (/^\d+$/.test(variantId)) {
		return `gid://shopify/ProductVariant/${variantId}`;
	}
	return variantId;
}
