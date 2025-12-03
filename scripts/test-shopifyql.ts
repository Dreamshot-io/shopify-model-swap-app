#!/usr/bin/env bun
/**
 * Proof of Concept: Test ShopifyQL queries for product analytics
 *
 * This script tests whether ShopifyQL can provide:
 * - Product-level view sessions (impressions)
 * - Add-to-cart sessions
 * - Purchase sessions
 * - Hourly granularity for rotation window correlation
 *
 * Usage:
 *   bun run scripts/test-shopifyql.ts [options]
 *
 * Options:
 *   --shop <domain>     Test specific shop (default: first active shop)
 *   --product <id>      Test specific product ID (Shopify GID or numeric)
 *   --days <n>          Look back N days (default: 7)
 *   --help              Show this help message
 *
 * Examples:
 *   bun run scripts/test-shopifyql.ts
 *   bun run scripts/test-shopifyql.ts --shop txemaleon.myshopify.com
 *   bun run scripts/test-shopifyql.ts --product 123456789
 *   bun run scripts/test-shopifyql.ts --days 30
 */

import prisma from '../app/db.server';

interface TestOptions {
	shop?: string;
	productId?: string;
	days: number;
}

interface ShopifyQLResponse {
	data?: {
		shopifyqlQuery?: {
			tableData?: {
				columns: Array<{ name: string; dataType: string; displayName: string }>;
				rows: string[][];
			};
			parseErrors?: string[];
		};
	};
	errors?: Array<{ message: string }>;
}

function parseArgs(): TestOptions {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
ShopifyQL Proof of Concept - Test product analytics queries

Usage: bun run scripts/test-shopifyql.ts [options]

Options:
  --shop <domain>     Test specific shop (default: first active shop)
  --product <id>      Test specific product ID (Shopify GID or numeric)
  --days <n>          Look back N days (default: 7)
  --help              Show this help message

This script will test various ShopifyQL queries to determine:
1. Which tables/datasets are available
2. What columns exist for product analytics
3. What time granularity is supported
4. Data latency (how fresh is the data)
		`);
		process.exit(0);
	}

	const shopIdx = args.indexOf('--shop');
	const shop = shopIdx >= 0 ? args[shopIdx + 1] : undefined;

	const productIdx = args.indexOf('--product');
	const productId = productIdx >= 0 ? args[productIdx + 1] : undefined;

	const daysIdx = args.indexOf('--days');
	const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 7;

	return { shop, productId, days };
}

async function getShopifyAdmin(shopId: string, shopDomain: string) {
	const credential = await prisma.shopCredential.findUnique({
		where: { id: shopId },
	});

	if (!credential) {
		throw new Error(`No credential found for shopId: ${shopId} (${shopDomain})`);
	}

	const session = await prisma.session.findFirst({
		where: {
			shopId: shopId,
			isOnline: false,
		},
		orderBy: {
			expires: 'desc',
		},
	});

	if (!session) {
		throw new Error(`No valid session found for shopId: ${credential.id} (${shopDomain})`);
	}

	const myshopifyDomain = session.shop;
	const accessToken = session.accessToken;

	// Convert API version format
	const versionMap: Record<string, string> = {
		January25: '2025-01',
		January24: '2024-01',
		April24: '2024-04',
		July24: '2024-07',
		October24: '2024-10',
	};
	const rawVersion = credential.apiVersion || 'January25';
	// Note: ShopifyQL requires 'unstable' API version AND beta access
	// Standard versions (2024-04 through 2025-01) have shopifyqlQuery sunset
	const apiVersion = 'unstable'; // Only version with shopifyqlQuery available

	const graphql = async (query: string): Promise<ShopifyQLResponse> => {
		const response = await fetch(
			`https://${myshopifyDomain}/admin/api/${apiVersion}/graphql.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': accessToken,
				},
				body: JSON.stringify({ query }),
			}
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`GraphQL request failed: ${response.status} ${text}`);
		}

		return response.json();
	};

	return { graphql, session, credential, apiVersion };
}

interface QueryTest {
	name: string;
	description: string;
	query: string;
	critical: boolean;
}

function buildTestQueries(days: number, productId?: string): QueryTest[] {
	const numericProductId = productId?.replace('gid://shopify/Product/', '');

	const queries: QueryTest[] = [
		// Test 1: Check if 'products' table exists with basic metrics
		{
			name: 'products_table_basic',
			description: 'Test if products table exists',
			query: `FROM products SHOW sum(view_sessions) SINCE -${days}d LIMIT 1`,
			critical: true,
		},

		// Test 2: Check available columns in products table
		{
			name: 'products_all_metrics',
			description: 'Test all expected metrics columns',
			query: `FROM products SHOW sum(view_sessions), sum(cart_sessions), sum(purchase_sessions) SINCE -${days}d LIMIT 1`,
			critical: true,
		},

		// Test 3: Test hourly granularity
		{
			name: 'products_hourly',
			description: 'Test hourly time granularity',
			query: `FROM products SHOW sum(view_sessions) GROUP BY hour SINCE -1d ORDER BY hour ASC LIMIT 24`,
			critical: true,
		},

		// Test 4: Test daily granularity (fallback)
		{
			name: 'products_daily',
			description: 'Test daily time granularity',
			query: `FROM products SHOW sum(view_sessions) GROUP BY day SINCE -${days}d ORDER BY day ASC`,
			critical: false,
		},

		// Test 5: Test product filtering
		...(numericProductId
			? [
					{
						name: 'products_filtered',
						description: `Test product filtering for ID ${numericProductId}`,
						query: `FROM products SHOW sum(view_sessions), sum(cart_sessions), sum(purchase_sessions) WHERE product_id = ${numericProductId} SINCE -${days}d`,
						critical: true,
					},
					{
						name: 'products_filtered_hourly',
						description: `Test product filtering with hourly granularity`,
						query: `FROM products SHOW sum(view_sessions), sum(cart_sessions), sum(purchase_sessions) WHERE product_id = ${numericProductId} GROUP BY hour SINCE -${days}d ORDER BY hour ASC`,
						critical: true,
					},
				]
			: []),

		// Test 6: Alternative table - 'product_views'
		{
			name: 'product_views_table',
			description: 'Test if product_views table exists (alternative)',
			query: `FROM product_views SHOW count(*) SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 7: Alternative table - 'sessions'
		{
			name: 'sessions_table',
			description: 'Test if sessions table exists (alternative)',
			query: `FROM sessions SHOW count(*) SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 8: Sales table (known to work from docs)
		{
			name: 'sales_table',
			description: 'Test sales table (known from docs)',
			query: `FROM sales SHOW sum(total_sales) SINCE -${days}d`,
			critical: false,
		},

		// Test 9: Check data freshness - most recent data point
		{
			name: 'data_freshness',
			description: 'Check most recent data timestamp',
			query: `FROM products SHOW sum(view_sessions) GROUP BY hour SINCE -1d ORDER BY hour DESC LIMIT 1`,
			critical: false,
		},

		// Test 10: Explore sales table with month grouping (from docs example)
		{
			name: 'sales_by_month',
			description: 'Test sales table with month grouping',
			query: `FROM sales SHOW total_sales GROUP BY month SINCE -3m ORDER BY month`,
			critical: false,
		},

		// Test 11: Try products table with different columns
		{
			name: 'products_explore',
			description: 'Explore products table structure',
			query: `FROM products SHOW * SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 12: Try orders table
		{
			name: 'orders_table',
			description: 'Test orders table',
			query: `FROM orders SHOW * SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 13: Try traffic/visitors
		{
			name: 'traffic_table',
			description: 'Test traffic/visitors table',
			query: `FROM traffic SHOW * SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 14: Try visitors
		{
			name: 'visitors_table',
			description: 'Test visitors table',
			query: `FROM visitors SHOW * SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 15: Sales with product_id filter
		{
			name: 'sales_product_filter',
			description: 'Test sales with product filter',
			query: `FROM sales SHOW total_sales WHERE product_id = ${numericProductId || '1'} GROUP BY day SINCE -${days}d`,
			critical: false,
		},

		// Test 16: Sales daily grouping
		{
			name: 'sales_daily',
			description: 'Test sales with day grouping',
			query: `FROM sales SHOW total_sales GROUP BY day SINCE -${days}d ORDER BY day`,
			critical: false,
		},

		// Test 17: Sales hourly grouping
		{
			name: 'sales_hourly',
			description: 'Test sales with hour grouping',
			query: `FROM sales SHOW total_sales GROUP BY hour SINCE -7d ORDER BY hour`,
			critical: false,
		},

		// Test 18: Products table - try different columns
		{
			name: 'products_net_sales',
			description: 'Test products with net_sales column',
			query: `FROM products SHOW net_sales SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 19: Products table - try gross_sales
		{
			name: 'products_gross_sales',
			description: 'Test products with gross_sales column',
			query: `FROM products SHOW gross_sales SINCE -${days}d LIMIT 1`,
			critical: false,
		},

		// Test 20: Products grouped by product_title
		{
			name: 'products_by_title',
			description: 'Test products grouped by product_title',
			query: `FROM products SHOW net_sales GROUP BY product_title SINCE -${days}d`,
			critical: false,
		},

		// Test 21: Products from official docs example
		{
			name: 'products_docs_example',
			description: 'Test exact query from Shopify docs',
			query: `FROM products SHOW sum(net_sales) AS product_sales GROUP BY product_title SINCE last_month UNTIL yesterday ORDER BY product_sales DESC LIMIT 5`,
			critical: false,
		},

		// Test 22: Products sessions from docs
		{
			name: 'products_sessions_docs',
			description: 'Test view_sessions with sum() as per docs',
			query: `FROM products SHOW sum(view_sessions), sum(cart_sessions), sum(purchase_sessions) SINCE -${days}d`,
			critical: false,
		},
	];

	return queries;
}

async function runQuery(
	graphql: (query: string) => Promise<ShopifyQLResponse>,
	shopifyqlQuery: string
): Promise<{
	success: boolean;
	data?: { columns: string[]; rows: string[][] };
	error?: string;
	parseErrors?: string[];
}> {
	try {
		const gqlQuery = `
			query TestShopifyQL {
				shopifyqlQuery(query: """${shopifyqlQuery}""") {
					tableData {
						columns {
							name
							dataType
							displayName
						}
						rows
					}
					parseErrors
				}
			}
		`;

		const response = await graphql(gqlQuery);

		if (response.errors && response.errors.length > 0) {
			return {
				success: false,
				error: response.errors.map((e) => e.message).join(', '),
			};
		}

		const queryResult = response.data?.shopifyqlQuery;

		if (queryResult?.parseErrors && queryResult.parseErrors.length > 0) {
			return {
				success: false,
				parseErrors: queryResult.parseErrors,
			};
		}

		if (!queryResult?.tableData) {
			return {
				success: false,
				error: 'No table data returned',
			};
		}

		return {
			success: true,
			data: {
				columns: queryResult.tableData.columns.map((c) => c.name),
				rows: queryResult.tableData.rows,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function main() {
	const options = parseArgs();

	console.log('='.repeat(70));
	console.log('  ShopifyQL Proof of Concept');
	console.log('='.repeat(70));
	console.log(`Days to look back: ${options.days}`);
	if (options.productId) {
		console.log(`Product filter: ${options.productId}`);
	}
	console.log('');

	// Get shop
	const shopQuery = options.shop ? { shopDomain: options.shop } : {};
	const shops = await prisma.shopCredential.findMany({
		where: {
			status: 'ACTIVE',
			...shopQuery,
		},
		select: {
			id: true,
			shopDomain: true,
		},
		take: 1,
	});

	if (shops.length === 0) {
		console.error('No active shops found');
		process.exit(1);
	}

	const shop = shops[0];
	console.log(`Shop: ${shop.shopDomain}`);

	// Check if read_reports scope exists
	const session = await prisma.session.findFirst({
		where: { shopId: shop.id, isOnline: false },
		select: { scope: true },
	});

	console.log(`Session scopes: ${session?.scope || 'none'}`);

	const hasReadReports = session?.scope?.includes('read_reports');
	if (!hasReadReports) {
		console.log('\n');
		console.log('='.repeat(70));
		console.log('  WARNING: read_reports scope NOT found!');
		console.log('='.repeat(70));
		console.log('');
		console.log('The app needs the read_reports scope to use ShopifyQL.');
		console.log('');
		console.log('To add this scope:');
		console.log('1. Update shopify.app.*.toml to include read_reports in scopes');
		console.log('2. Run: shopify app deploy');
		console.log('3. Merchants must re-authenticate to grant the new scope');
		console.log('');
		console.log('Attempting queries anyway (will likely fail)...');
		console.log('');
	}

	const { graphql, apiVersion } = await getShopifyAdmin(shop.id, shop.shopDomain);
	console.log(`API Version: ${apiVersion}`);

	// If no product specified, try to find one from an A/B test
	let productId = options.productId;
	if (!productId) {
		const test = await prisma.aBTest.findFirst({
			where: { shop: shop.shopDomain },
			select: { productId: true },
		});
		if (test) {
			productId = test.productId;
			console.log(`Using product from A/B test: ${productId}`);
		}
	}

	const queries = buildTestQueries(options.days, productId);

	console.log('\n');
	console.log('='.repeat(70));
	console.log('  Running Tests');
	console.log('='.repeat(70));

	const results: Array<{
		name: string;
		description: string;
		success: boolean;
		critical: boolean;
		error?: string;
		parseErrors?: string[];
		columns?: string[];
		rowCount?: number;
		sampleData?: string[][];
	}> = [];

	for (const test of queries) {
		console.log(`\nTest: ${test.name}`);
		console.log(`  ${test.description}`);
		console.log(`  Query: ${test.query.substring(0, 80)}${test.query.length > 80 ? '...' : ''}`);

		const result = await runQuery(graphql, test.query);

		if (result.success && result.data) {
			console.log(`  Result: SUCCESS`);
			console.log(`  Columns: ${result.data.columns.join(', ')}`);
			console.log(`  Rows: ${result.data.rows.length}`);
			if (result.data.rows.length > 0) {
				console.log(`  Sample: ${JSON.stringify(result.data.rows.slice(0, 3))}`);
			}
			results.push({
				name: test.name,
				description: test.description,
				success: true,
				critical: test.critical,
				columns: result.data.columns,
				rowCount: result.data.rows.length,
				sampleData: result.data.rows.slice(0, 3),
			});
		} else {
			console.log(`  Result: FAILED`);
			if (result.parseErrors) {
				console.log(`  Parse Errors: ${result.parseErrors.join(', ')}`);
			}
			if (result.error) {
				console.log(`  Error: ${result.error}`);
			}
			results.push({
				name: test.name,
				description: test.description,
				success: false,
				critical: test.critical,
				error: result.error,
				parseErrors: result.parseErrors,
			});
		}
	}

	// Summary
	console.log('\n');
	console.log('='.repeat(70));
	console.log('  SUMMARY');
	console.log('='.repeat(70));

	const criticalTests = results.filter((r) => r.critical);
	const criticalPassed = criticalTests.filter((r) => r.success);
	const allTests = results;
	const allPassed = allTests.filter((r) => r.success);

	console.log(`\nCritical tests: ${criticalPassed.length}/${criticalTests.length} passed`);
	console.log(`All tests: ${allPassed.length}/${allTests.length} passed`);

	console.log('\nCritical test results:');
	for (const test of criticalTests) {
		const status = test.success ? 'PASS' : 'FAIL';
		console.log(`  [${status}] ${test.name}: ${test.description}`);
		if (!test.success) {
			if (test.parseErrors) {
				console.log(`         Parse errors: ${test.parseErrors.join(', ')}`);
			}
			if (test.error) {
				console.log(`         Error: ${test.error}`);
			}
		}
	}

	// Feasibility assessment
	console.log('\n');
	console.log('='.repeat(70));
	console.log('  FEASIBILITY ASSESSMENT');
	console.log('='.repeat(70));

	const productsTableWorks = results.find((r) => r.name === 'products_table_basic')?.success;
	const hourlyWorks = results.find((r) => r.name === 'products_hourly')?.success;
	const dailyWorks = results.find((r) => r.name === 'products_daily')?.success;
	const filterWorks = results.find((r) => r.name === 'products_filtered')?.success;
	const allMetricsWork = results.find((r) => r.name === 'products_all_metrics')?.success;

	if (productsTableWorks && allMetricsWork && (hourlyWorks || dailyWorks)) {
		console.log('\nPRD APPROACH IS FEASIBLE');
		console.log('');
		console.log('Findings:');
		console.log(`  - products table exists: ${productsTableWorks ? 'YES' : 'NO'}`);
		console.log(`  - view_sessions/cart_sessions/purchase_sessions: ${allMetricsWork ? 'YES' : 'NO'}`);
		console.log(`  - Hourly granularity: ${hourlyWorks ? 'YES' : 'NO (use daily)'}`);
		console.log(`  - Product filtering: ${filterWorks ?? 'NOT TESTED'}`);

		if (!hourlyWorks && dailyWorks) {
			console.log('\nNOTE: Hourly granularity not available. PRD needs adjustment to use daily.');
			console.log('This affects rotation window correlation accuracy.');
		}
	} else if (!hasReadReports) {
		console.log('\nCANNOT ASSESS - SCOPE MISSING');
		console.log('');
		console.log('Add read_reports scope and re-run this script.');
	} else {
		console.log('\nPRD APPROACH MAY NOT BE FEASIBLE');
		console.log('');
		console.log('Issues found:');
		if (!productsTableWorks) {
			console.log('  - products table does not exist or has different name');
		}
		if (!allMetricsWork) {
			console.log('  - Expected metrics columns not available');
		}
		if (!hourlyWorks && !dailyWorks) {
			console.log('  - No time-based grouping available');
		}
		console.log('');
		console.log('Check alternative tables that worked:');
		const alternatives = results.filter(
			(r) => r.success && !r.name.startsWith('products_')
		);
		for (const alt of alternatives) {
			console.log(`  - ${alt.name}: ${alt.columns?.join(', ')}`);
		}
	}

	console.log('\n');
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('\nFatal error:', error);
		process.exit(1);
	});
