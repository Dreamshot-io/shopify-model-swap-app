/**
 * Daily statistics export API route
 * Called by external scheduler (GitHub Actions, Vercel Cron, etc.)
 * Generates statistics exports for ALL products across ALL shops
 */

import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import prisma from '~/db.server';
import { exportProductStatistics } from '~/services/statistics-export';
import { unauthenticated } from '~/shopify.server';

/**
 * Validate request is from Vercel Cron
 * Vercel automatically adds Authorization header with CRON_SECRET
 */
function validateCronRequest(request: Request): boolean {
	const authHeader = request.headers.get('authorization');
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret) {
		console.warn('[statistics-export] CRON_SECRET not configured');
		return false;
	}

	return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Get Shopify admin GraphQL client for a shop
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

	if (!session) {
		throw new Error(`No valid session found for shop: ${shopDomain}`);
	}

	// Create Shopify admin client from session
	const admin = unauthenticated.admin(shopDomain);

	return {
		graphql: admin.graphql,
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
 * POST /api/statistics-export/daily
 * Runs daily statistics export for all shops
 */
export const action = async ({ request }: ActionFunctionArgs) => {
	// Validate request is from Vercel Cron
	if (!validateCronRequest(request)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// Parse request body
		const formData = await request.formData();
		const dateStr = formData.get('date') as string | null;

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
};
