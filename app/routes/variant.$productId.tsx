import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	// CRITICAL: Add proper authentication with HMAC validation
	try {
		const { session, cors } = await authenticate.public.appProxy(request);

		// Fallback CORS headers if cors object is undefined
		const corsHeaders = cors?.headers || {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		const url = new URL(request.url);
		const sessionId = url.searchParams.get('session');
		const forcedVariant = url.searchParams.get('force')?.toUpperCase(); // Get forced variant (A or B)
		const variantId = url.searchParams.get('variantId'); // Shopify variant ID
		const productId = params.productId ? decodeURIComponent(params.productId) : undefined;

		console.log('[variant] Request received:', {
			productId,
			variantId,
			sessionId: sessionId?.substring(0, 20) + '...',
			shop: session?.shop,
			hasSession: !!session,
			hasCors: !!cors,
			forcedVariant: forcedVariant || 'none',
		});

		if (!sessionId || !productId) {
			console.error('[variant] Missing required params:', {
				sessionId: !!sessionId,
				productId: !!productId,
			});
			return json({ error: 'Missing session or productId' }, { status: 400, headers: corsHeaders });
		}

		if (!session?.shop) {
			console.error('[variant] No shop in session');
			return json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
		}

		// Try to find variant-specific test first if variantId is provided
		let activeTest = null;

		if (variantId) {
			activeTest = await db.aBTest.findFirst({
				where: {
					productId: productId!,
					shop: session.shop,
					status: 'RUNNING',
					variantScope: 'VARIANT',
					variants: {
						some: {
							shopifyVariantId: variantId,
						},
					},
				},
				include: {
					variants: true,
				},
			});

			console.log('[variant] Variant-specific test query:', {
				found: !!activeTest,
				variantId,
				testId: activeTest?.id,
			});
		}

		// Fall back to product-wide test if no variant-specific test found
		if (!activeTest) {
			activeTest = await db.aBTest.findFirst({
				where: {
					productId: productId!,
					shop: session.shop,
					status: 'RUNNING',
					OR: [
						{ variantScope: 'PRODUCT' },
						{ variantScope: null }, // backward compatibility
					],
				},
				include: {
					variants: true,
				},
			});

			console.log('[variant] Product-wide test query:', {
				found: !!activeTest,
				testId: activeTest?.id,
				variantCount: activeTest?.variants.length,
			});
		}

		if (!activeTest || activeTest.variants.length < 2) {
			console.log('[variant] No active test found or not enough variants');
			return json({ variant: null }, { headers: corsHeaders });
		}

		// Filter variants based on scope
		let relevantVariants;
		if (activeTest.variantScope === 'VARIANT') {
			// For variant-scoped tests, filter to specific Shopify variant
			if (variantId) {
				relevantVariants = activeTest.variants.filter(v => v.shopifyVariantId === variantId);
				console.log(
					`[variant] Filtered to ${relevantVariants.length} variants for Shopify variant ${variantId}`,
				);
			} else {
				// No variantId provided, try to use any available variant pair
				// Group by shopifyVariantId and pick first group with both A and B
				const variantGroups = new Map<string, typeof activeTest.variants>();
				activeTest.variants.forEach(v => {
					const key = v.shopifyVariantId || 'null';
					if (!variantGroups.has(key)) {
						variantGroups.set(key, []);
					}
					variantGroups.get(key)!.push(v);
				});

				// Find first complete group (has both A and B)
				for (const [key, group] of variantGroups.entries()) {
					if (
						group.length === 2 &&
						group.some(v => v.variant === 'A') &&
						group.some(v => v.variant === 'B')
					) {
						relevantVariants = group;
						console.log(`[variant] No variantId provided, using default group for ${key}`);
						break;
					}
				}

				if (!relevantVariants) {
					console.log('[variant] No valid variant group found');
					return json({ variant: null }, { headers: corsHeaders });
				}
			}
		} else {
			// Product-wide test - use all variants (should be 2: A and B)
			relevantVariants = activeTest.variants.filter(
				v => v.shopifyVariantId === null || v.shopifyVariantId === undefined,
			);
			console.log(`[variant] Product-wide test, using ${relevantVariants.length} variants`);
		}

		if (relevantVariants.length !== 2) {
			console.log(
				'[variant] Invalid number of relevant variants:',
				relevantVariants.length,
				'Expected 2 (A and B)',
			);
			return json({ variant: null }, { headers: corsHeaders });
		}

		// Verify we have both A and B
		const hasA = relevantVariants.some(v => v.variant === 'A');
		const hasB = relevantVariants.some(v => v.variant === 'B');
		if (!hasA || !hasB) {
			console.log('[variant] Missing A or B variant');
			return json({ variant: null }, { headers: corsHeaders });
		}

		const sanitizeImages = (raw: string): string[] => {
			if (!raw) return [];

			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return Array.from(
						new Set(
							parsed.filter((url): url is string => typeof url === 'string' && url.trim().length > 0),
						),
					).slice(0, 6);
				}

				if (typeof parsed === 'string' && parsed.trim().length > 0) {
					return [parsed.trim()];
				}
			} catch (error) {
				if (raw.trim().length > 0) {
					return [raw.trim()];
				}
			}

			return [];
		};

		const variantImageMap = new Map<string, string[]>();
		for (const variant of relevantVariants) {
			variantImageMap.set(variant.variant, sanitizeImages(variant.imageUrls));
		}

		const pickImagesForVariant = (variant: string): string[] => {
			const baseImages = variantImageMap.get(variant) ?? [];
			if (!baseImages.length) return baseImages;

			const otherVariant = variant === 'A' ? 'B' : 'A';
			const otherImages = variantImageMap.get(otherVariant) ?? [];

			if (!otherImages.length) {
				return baseImages;
			}

			const uniqueImages = baseImages.filter(url => !otherImages.includes(url));

			if (!uniqueImages.length) {
				console.warn(
					'[variant] Variant',
					variant,
					'shares all images with',
					otherVariant,
					'- returning full set',
				);
				return baseImages;
			}

			return uniqueImages;
		};

		let selectedVariant: string;
		let existingEvent = null;

		// Check for forced variant (for testing/debugging)
		if (forcedVariant && (forcedVariant === 'A' || forcedVariant === 'B')) {
			selectedVariant = forcedVariant;
			console.log('[variant] 🔧 Using forced variant:', selectedVariant);
		} else {
			// Check if user already has a variant assigned
			existingEvent = await db.aBTestEvent.findFirst({
				where: {
					testId: activeTest.id,
					sessionId,
				},
			});

			if (existingEvent) {
				// Use existing variant assignment
				selectedVariant = existingEvent.variant;
			} else {
				// Assign new variant based on traffic split
				const random = Math.random() * 100;
				selectedVariant = random < activeTest.trafficSplit ? 'A' : 'B';
			}
		}

		// Find the variant data matching both selectedVariant (A/B) and shopifyVariantId
		const variantData = relevantVariants.find(v => v.variant === selectedVariant);

		console.log(
			'[variant] Looking for variant:',
			selectedVariant,
			'from relevant variants:',
			relevantVariants.map(v => `${v.variant}(${v.shopifyVariantId || 'product-wide'})`),
		);

		if (!variantData) {
			console.error('[variant] Variant not found:', selectedVariant, 'in relevant variants:', relevantVariants);
			return json({ error: 'Variant not found' }, { status: 404, headers: corsHeaders });
		}

		// Parse image URLs
		let imageUrls = pickImagesForVariant(selectedVariant);

		if (!imageUrls.length) {
			console.warn('[variant] Variant', selectedVariant, 'has no usable images; searching for fallback variant');

			const fallbackEntry = Array.from(variantImageMap.entries()).find(([, images]) => images.length > 0);

			if (fallbackEntry) {
				const [fallbackVariant] = fallbackEntry;
				selectedVariant = fallbackVariant;
				imageUrls = pickImagesForVariant(fallbackVariant);
				console.warn('[variant] Falling back to variant', fallbackVariant, 'with', imageUrls.length, 'images');
			}
		}

		// Track impression if this is a new session (but not for forced variants)
		if (!existingEvent && !forcedVariant) {
			try {
				await db.aBTestEvent.create({
					data: {
						testId: activeTest.id,
						sessionId,
						variant: selectedVariant,
						eventType: 'IMPRESSION',
						productId,
						variantId: variantId || null,
					},
				});
				console.log('[variant] Impression tracked for variant:', selectedVariant);
			} catch (dbError) {
				console.error('[variant] Failed to track impression:', dbError);
				// Don't fail the request if tracking fails
			}
		} else if (forcedVariant) {
			console.log('[variant] Skipping impression tracking for forced variant');
		}

		return json(
			{
				variant: selectedVariant,
				imageUrls,
				testId: activeTest.id,
			},
			{
				headers: corsHeaders, // Use Shopify's CORS headers or fallback
			},
		);
	} catch (error) {
		// If Shopify auth throws a Response (e.g., 401 invalid/missing HMAC), return it
		if (error instanceof Response) {
			console.error('[variant] Auth response error:', error.status, error.statusText);
			return error;
		}

		console.error('[variant] Unhandled error:', error);
		console.error('[variant] Error stack:', error instanceof Error ? error.stack : 'No stack');
		console.error('[variant] Error details:', {
			name: error instanceof Error ? error.name : typeof error,
			message: error instanceof Error ? error.message : String(error),
		});

		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
