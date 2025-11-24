#!/usr/bin/env bun
/**
 * Backfill daily statistics exports
 * Generates statistics exports for past dates that were missed
 * Safe to run multiple times (idempotent - skips existing exports)
 */

import prisma from '../app/db.server';
import { exportProductStatistics } from '../app/services/statistics-export';
import { unauthenticated } from '../app/shopify.server';

interface BackfillOptions {
	startDate: Date;
	endDate: Date;
	dryRun?: boolean;
}

/**
 * Get Shopify admin GraphQL client for a shop
 * Uses shopId FK to find session (handles custom domains correctly)
 */
async function getShopifyAdmin(shopDomain: string) {
	// Get shop credential
	const credential = await prisma.shopCredential.findUnique({
		where: { shopDomain },
	});

	if (!credential) {
		throw new Error(`No credential found for shop: ${shopDomain}`);
	}

	// Find session by shopId FK (not by shop domain)
	const session = await prisma.session.findFirst({
		where: {
			shopId: credential.id,
			isOnline: false,
		},
		orderBy: {
			expires: 'desc',
		},
	});

	if (!session) {
		throw new Error(`No valid session found for shopId: ${credential.id} (${shopDomain})`);
	}

	// Create a simple GraphQL client using the session's access token
	// This bypasses the unauthenticated.admin lookup which has issues with custom domains
	const myshopifyDomain = session.shop;
	const accessToken = session.accessToken;
	
	// Convert API version format (January25 -> 2025-01)
	const versionMap: Record<string, string> = {
		'January25': '2025-01',
		'January24': '2024-01',
		'April24': '2024-04',
		'July24': '2024-07',
		'October24': '2024-10',
	};
	const rawVersion = credential.apiVersion || 'January25';
	const apiVersion = versionMap[rawVersion] || '2024-01';

	const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
		const response = await fetch(
			`https://${myshopifyDomain}/admin/api/${apiVersion}/graphql.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': accessToken,
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
		graphql,
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
 * Check if export already exists for shop/date
 */
async function exportExists(shopId: string, date: Date): Promise<boolean> {
	const existing = await prisma.statisticsExport.findFirst({
		where: {
			shop: shopId,
			date,
		},
	});
	return !!existing;
}

/**
 * Export statistics for a single shop on a specific date
 * Idempotent: skips if exports already exist for this shop/date
 */
async function exportShopStatisticsForDate(
	shopId: string,
	shopDomain: string,
	date: Date,
	dryRun = false,
): Promise<{
	success: boolean;
	skipped: boolean;
	productsExported: number;
	variantsExported: number;
	errors: string[];
}> {
	// Check if already exported
	const exists = await exportExists(shopId, date);
	if (exists) {
		console.log(`  ⏭️  Skip: exports already exist for ${date.toISOString().split('T')[0]}`);
		return {
			success: true,
			skipped: true,
			productsExported: 0,
			variantsExported: 0,
			errors: [],
		};
	}

	if (dryRun) {
		console.log(`  📝 Dry run: would export for ${date.toISOString().split('T')[0]}`);
		return {
			success: true,
			skipped: false,
			productsExported: 0,
			variantsExported: 0,
			errors: [],
		};
	}

	try {
		const { graphql } = await getShopifyAdmin(shopDomain);

		// Fetch products
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
			{ variables: { first: 250 } },
		);

		const data = await response.json();
		const products =
			data.data?.products?.edges?.map((edge: { node: { id: string; title: string } }) => edge.node) ||
			[];

		const errors: string[] = [];
		let variantsExported = 0;

		// Export each product
		for (const product of products) {
			try {
				const results = await exportProductStatistics(
					graphql,
					shopId,
					shopDomain,
					product.id,
					product.id,
					date,
				);

				const successCount = results.filter((r) => r.success).length;
				variantsExported += successCount;

				const failed = results.filter((r) => !r.success);
				if (failed.length > 0) {
					errors.push(`Product ${product.id}: ${failed.length} variant(s) failed`);
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				errors.push(`Product ${product.id}: ${errorMsg}`);
			}
		}

		return {
			success: errors.length === 0,
			skipped: false,
			productsExported: products.length,
			variantsExported,
			errors,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		return {
			success: false,
			skipped: false,
			productsExported: 0,
			variantsExported: 0,
			errors: [errorMsg],
		};
	}
}

/**
 * Backfill statistics for all shops across a date range
 */
async function backfillStatistics(options: BackfillOptions) {
	const { startDate, endDate, dryRun = false } = options;

	console.log('📊 Statistics Export Backfill');
	console.log('='.repeat(60));
	console.log(`Start date: ${startDate.toISOString().split('T')[0]}`);
	console.log(`End date:   ${endDate.toISOString().split('T')[0]}`);
	console.log(`Dry run:    ${dryRun ? 'YES (no changes)' : 'NO (will export)'}`);
	console.log('='.repeat(60));

	// Get active shops
	const shops = await getAllActiveShops();
	console.log(`\n🏪 Found ${shops.length} active shops\n`);

	// Generate dates array
	const dates: Date[] = [];
	const current = new Date(startDate);
	while (current <= endDate) {
		dates.push(new Date(current));
		current.setUTCDate(current.getUTCDate() + 1);
	}

	console.log(`📅 Processing ${dates.length} date(s)\n`);

	// Process each shop
	for (const shop of shops) {
		console.log(`\n🏪 Shop: ${shop.shopDomain}`);
		console.log('-'.repeat(60));

		// Process each date for this shop
		for (const date of dates) {
			console.log(`\n📅 Date: ${date.toISOString().split('T')[0]}`);

			const result = await exportShopStatisticsForDate(
				shop.id,
				shop.shopDomain,
				date,
				dryRun,
			);

			if (result.skipped) {
				continue;
			}

			if (result.success) {
				console.log(
					`  ✅ Success: ${result.productsExported} products, ${result.variantsExported} variants`,
				);
			} else {
				console.log(`  ❌ Failed with ${result.errors.length} error(s)`);
				result.errors.forEach((err) => console.log(`     - ${err}`));
			}
		}
	}

	console.log('\n' + '='.repeat(60));
	console.log('✅ Backfill complete');
	console.log('='.repeat(60));
}

/**
 * Parse CLI arguments
 */
function parseArgs(): BackfillOptions {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes('--help')) {
		console.log(`
Usage: bun run scripts/backfill-daily-statistics.ts [options]

Options:
  --days N        Backfill last N days (default: 5)
  --start DATE    Start date (YYYY-MM-DD)
  --end DATE      End date (YYYY-MM-DD)
  --dry-run       Preview without making changes

Examples:
  # Backfill last 5 days
  bun run scripts/backfill-daily-statistics.ts

  # Backfill last 7 days
  bun run scripts/backfill-daily-statistics.ts --days 7

  # Backfill specific date range
  bun run scripts/backfill-daily-statistics.ts --start 2025-01-01 --end 2025-01-05

  # Dry run to preview
  bun run scripts/backfill-daily-statistics.ts --days 3 --dry-run
		`);
		process.exit(0);
	}

	let startDate: Date;
	let endDate: Date;
	let dryRun = false;

	const daysIdx = args.indexOf('--days');
	const startIdx = args.indexOf('--start');
	const endIdx = args.indexOf('--end');
	dryRun = args.includes('--dry-run');

	if (startIdx >= 0 && endIdx >= 0) {
		// Use explicit date range
		startDate = new Date(args[startIdx + 1]);
		endDate = new Date(args[endIdx + 1]);
	} else if (daysIdx >= 0) {
		// Use last N days
		const days = parseInt(args[daysIdx + 1], 10);
		endDate = new Date();
		endDate.setUTCDate(endDate.getUTCDate() - 1); // Yesterday
		endDate.setUTCHours(0, 0, 0, 0);

		startDate = new Date(endDate);
		startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
	} else {
		// Default: last 5 days
		endDate = new Date();
		endDate.setUTCDate(endDate.getUTCDate() - 1); // Yesterday
		endDate.setUTCHours(0, 0, 0, 0);

		startDate = new Date(endDate);
		startDate.setUTCDate(startDate.getUTCDate() - 4); // 5 days total
	}

	// Normalize to UTC midnight
	startDate.setUTCHours(0, 0, 0, 0);
	endDate.setUTCHours(0, 0, 0, 0);

	return { startDate, endDate, dryRun };
}

// Run backfill
const options = parseArgs();
backfillStatistics(options)
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
