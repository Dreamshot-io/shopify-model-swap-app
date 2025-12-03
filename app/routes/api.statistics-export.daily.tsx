/**
 * Daily statistics export API route
 * Called by external scheduler (GitHub Actions, Vercel Cron, etc.)
 * Generates statistics exports for ALL products across ALL shops
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import prisma from '~/db.server';
import { exportProductStatistics } from '~/services/statistics-export';

/**
 * Validate request is from Vercel Cron
 * Vercel sends x-vercel-cron: 1 header for cron jobs
 * Manual requests can use Authorization: Bearer CRON_SECRET
 */
function validateCronRequest(request: Request): boolean {
	// Check Vercel cron header (Vercel automatically sets this for cron jobs)
	const vercelCronHeader = request.headers.get('x-vercel-cron');
	if (vercelCronHeader === '1') {
		return true;
	}

	// Check CRON_SECRET bearer token for manual triggers
	const authHeader = request.headers.get('authorization');
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
		return true;
	}

	console.warn('[statistics-export] Unauthorized: no valid cron header or secret');
	return false;
}

/**
 * Get Shopify admin GraphQL client for a shop
 * Creates a direct GraphQL client using stored session access token
 */
async function getShopifyAdmin(shopDomain: string) {
	const session = await prisma.session.findFirst({
		where: {
			shop: shopDomain,
			isOnline: false, // Use offline session for background jobs
		},
		orderBy: {
			expires: 'desc',
		},
	});

	if (!session || !session.accessToken) {
		throw new Error(`No valid session found for shop: ${shopDomain}`);
	}

	// Create GraphQL client directly using the stored access token
	// Returns { json: () => Promise } to match AdminApiContext['graphql'] interface
	const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
		const response = await fetch(
			`https://${session.shop}/admin/api/2025-01/graphql.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': session.accessToken,
				},
				body: JSON.stringify({
					query,
					variables: options?.variables || {},
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`GraphQL request failed: ${response.status} ${text}`);
		}

		return {
			json: async () => response.json(),
		};
	};

	return {
		graphql: graphql as unknown as AdminApiContext['graphql'],
		session,
	};
}

/**
 * Get all active shops
 */
async function getAllActiveShops() {
	return prisma.shopCredential.findMany({
		where: {
			status: 'ACTIVE',
		},
		select: {
			id: true,
			shopDomain: true,
		},
	});
}

/**
 * Export statistics for a single shop
 */
async function exportShopStatistics(
	shopId: string,
	shopDomain: string,
	date: Date,
): Promise<{
	success: boolean;
	productsExported: number;
	variantsExported: number;
	errors: string[];
}> {
	try {
		const { graphql } = await getShopifyAdmin(shopDomain);

		// Fetch all products for this shop
		const response = await graphql(
			`#graphql
				query GetProducts($first: Int!) {
					products(first: $first, sortKey: UPDATED_AT, reverse: true) {
						edges {
							node {
								id
								title
							}
						}
					}
				}`,
			{
				variables: { first: 250 },
			},
		);

		const data = await response.json();
		const products = data.data?.products?.edges?.map((edge: { node: { id: string; title: string } }) => edge.node) || [];

		const errors: string[] = [];
		let variantsExported = 0;

		// Export each product
		for (const product of products) {
			try {
				const results = await exportProductStatistics(
					graphql,
					shopId,
					shopDomain,
					product.id, // This should be the internal product ID
					product.id, // This is the Shopify GID
					date,
					{
						shopName: shopDomain,
						productTitle: product.title,
					},
				);

				// Count successful exports
				const successCount = results.filter((r) => r.success).length;
				variantsExported += successCount;

				// Collect errors
				const failed = results.filter((r) => !r.success);
				if (failed.length > 0) {
					errors.push(`Product ${product.id}: ${failed.length} variant(s) failed`);
				}
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				errors.push(`Product ${product.id}: ${errorMsg}`);
			}
		}

		return {
			success: errors.length === 0,
			productsExported: products.length,
			variantsExported,
			errors,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		return {
			success: false,
			productsExported: 0,
			variantsExported: 0,
			errors: [errorMsg],
		};
	}
}

/**
 * Shared handler for statistics export
 */
async function handleStatisticsExport(request: Request, dateStr?: string | null) {
	// Validate request is from Vercel Cron
	if (!validateCronRequest(request)) {
		console.log('[statistics-export] Unauthorized request rejected');
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	console.log('[statistics-export] Cron triggered');

	try {
		// Default to yesterday UTC
		const date = dateStr
			? new Date(dateStr)
			: (() => {
					const yesterday = new Date();
					yesterday.setUTCDate(yesterday.getUTCDate() - 1);
					yesterday.setUTCHours(0, 0, 0, 0);
					return yesterday;
				})();

		console.log(`[statistics-export] Starting daily export for ${date.toISOString().split('T')[0]}`);

		// Get all active shops
		const shops = await getAllActiveShops();
		console.log(`[statistics-export] Found ${shops.length} active shops`);

		// Export for each shop
		const results = [];
		for (const shop of shops) {
			console.log(`[statistics-export] Exporting shop: ${shop.shopDomain}`);

			const result = await exportShopStatistics(shop.id, shop.shopDomain, date);

			results.push({
				shopId: shop.id,
				shopDomain: shop.shopDomain,
				...result,
			});

			console.log(
				`[statistics-export] Shop ${shop.shopDomain}: ${result.productsExported} products, ${result.variantsExported} variants exported`,
			);
		}

		// Calculate totals
		const totals = {
			shopsProcessed: shops.length,
			totalProducts: results.reduce((sum, r) => sum + r.productsExported, 0),
			totalVariants: results.reduce((sum, r) => sum + r.variantsExported, 0),
			shopsWithErrors: results.filter((r) => r.errors.length > 0).length,
		};

		console.log(`[statistics-export] Daily export completed:`, totals);

		return json({
			success: true,
			date: date.toISOString().split('T')[0],
			totals,
			results,
		});
	} catch (error) {
		console.error('[statistics-export] Daily export failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 },
		);
	}
}

/**
 * GET /api/statistics-export/daily
 * Called by Vercel Cron
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
	return handleStatisticsExport(request);
};

/**
 * POST /api/statistics-export/daily
 * For manual triggers with optional date parameter
 */
export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const dateStr = formData.get('date') as string | null;
	return handleStatisticsExport(request, dateStr);
};
