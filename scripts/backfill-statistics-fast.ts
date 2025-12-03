#!/usr/bin/env bun
/**
 * Fast statistics backfill using pure SQL
 * No image backups, no transactions per record - just bulk SQL inserts
 */

import prisma from '../app/db.server';
import { randomUUID } from 'crypto';

interface BackfillOptions {
	startDate: Date;
	endDate: Date;
	dryRun?: boolean;
}

/**
 * Backfill statistics using pure SQL bulk insert
 */
async function backfillStatisticsFast(options: BackfillOptions) {
	const { startDate, endDate, dryRun = false } = options;

	console.log('📊 Fast Statistics Backfill (Pure SQL)');
	console.log('='.repeat(60));
	console.log(`Start date: ${startDate.toISOString().split('T')[0]}`);
	console.log(`End date:   ${endDate.toISOString().split('T')[0]}`);
	console.log(`Dry run:    ${dryRun ? 'YES' : 'NO'}`);
	console.log('='.repeat(60));

	// Step 1: Aggregate events
	console.log('\n📈 Aggregating events...');
	const aggregated = await prisma.$queryRaw<
		Array<{
			shopId: string;
			shopName: string | null;
			productId: string;
			variantId: string;
			date: Date;
			impressions: bigint;
			addToCarts: bigint;
			orders: bigint;
			revenue: number;
		}>
	>`
		SELECT
			e."shopId",
			COALESCE(s."shopName", s."shopDomain") as "shopName",
			e."productId",
			COALESCE(e."variantId", e."productId") as "variantId",
			DATE(e."createdAt") as date,
			COUNT(*) FILTER (WHERE e."eventType" = 'IMPRESSION') as impressions,
			COUNT(*) FILTER (WHERE e."eventType" = 'ADD_TO_CART') as "addToCarts",
			COUNT(*) FILTER (WHERE e."eventType" = 'PURCHASE') as orders,
			COALESCE(SUM(e."revenue") FILTER (WHERE e."eventType" = 'PURCHASE'), 0) as revenue
		FROM "ABTestEvent" e
		JOIN "ShopCredential" s ON e."shopId" = s.id
		WHERE e."shopId" IS NOT NULL
			AND e."createdAt" >= ${startDate}
			AND e."createdAt" < ${new Date(endDate.getTime() + 24 * 60 * 60 * 1000)}
		GROUP BY e."shopId", s."shopName", s."shopDomain", e."productId", 
			COALESCE(e."variantId", e."productId"), DATE(e."createdAt")
	`;

	console.log(`   Found ${aggregated.length} combinations`);

	if (aggregated.length === 0) {
		console.log('\n⚠️  No events found');
		return;
	}

	// Step 2: Get existing to skip
	console.log('\n🔍 Checking existing...');
	const existing = await prisma.$queryRaw<Array<{ key: string }>>`
		SELECT CONCAT("shopId", '|', "productId", '|', "variantId", '|', DATE(date)) as key
		FROM "StatisticsExport"
		WHERE date >= ${startDate} AND date <= ${endDate}
	`;
	const existingKeys = new Set(existing.map((e) => e.key));
	console.log(`   Found ${existingKeys.size} existing (will skip)`);

	// Step 3: Filter to new records only
	const toInsert = aggregated.filter((r) => {
		const key = `${r.shopId}|${r.productId}|${r.variantId}|${r.date.toISOString().split('T')[0]}`;
		return !existingKeys.has(key);
	});

	console.log(`\n📝 ${toInsert.length} new records to insert`);

	if (toInsert.length === 0) {
		console.log('\n✅ Nothing to insert');
		return;
	}

	if (dryRun) {
		console.log('\n🔍 Dry run - first 5:');
		for (const r of toInsert.slice(0, 5)) {
			console.log(
				`   ${r.shopName} | ${r.date.toISOString().split('T')[0]} | ${r.impressions} imp, ${r.orders} orders`,
			);
		}
		console.log('\n✅ Dry run complete');
		return;
	}

	// Step 4: Bulk insert using createMany
	console.log('\n💾 Inserting with createMany...');

	const now = new Date();
	const exportData = toInsert.map((r) => {
		const id = randomUUID().replace(/-/g, '').slice(0, 25);
		const dateStr = r.date.toISOString().split('T')[0].replace(/-/g, '');
		const impressions = Number(r.impressions);
		const addToCarts = Number(r.addToCarts);
		const orders = Number(r.orders);
		const revenue = Number(r.revenue);
		const ctr = impressions > 0 ? addToCarts / impressions : 0;

		return {
			id,
			shopId: r.shopId,
			shopName: r.shopName,
			productId: r.productId,
			variantId: r.variantId,
			date: r.date,
			impressions,
			addToCarts,
			orders,
			revenue,
			ctr,
			convRate: impressions > 0 ? orders / impressions : 0,
			csvR2Key: `backfill/${r.shopId}/${dateStr}.csv`,
			jsonR2Key: `backfill/${r.shopId}/${dateStr}.json`,
		};
	});

	try {
		// Bulk insert StatisticsExport
		console.log('   Inserting StatisticsExport...');
		await prisma.statisticsExport.createMany({
			data: exportData.map((v) => ({
				id: v.id,
				productId: v.productId,
				variantId: v.variantId,
				date: v.date,
				shopName: v.shopName,
				csvR2Key: v.csvR2Key,
				jsonR2Key: v.jsonR2Key,
				csvUrl: '',
				jsonUrl: '',
				shopId: v.shopId,
				metricsSnapshot: {
					impressions: v.impressions,
					addToCarts: v.addToCarts,
					orders: v.orders,
					revenue: v.revenue,
					ctr: v.ctr,
				},
				exportedAt: now,
			})),
			skipDuplicates: true,
		});

		// Bulk insert VariantDailyStatistics
		console.log('   Inserting VariantDailyStatistics...');
		await prisma.variantDailyStatistics.createMany({
			data: exportData.map((v) => ({
				id: randomUUID().replace(/-/g, '').slice(0, 25),
				exportId: v.id,
				productId: v.productId,
				variantId: v.variantId,
				date: v.date,
				shopName: v.shopName,
				impressions: v.impressions,
				addToCarts: v.addToCarts,
				orders: v.orders,
				revenue: v.revenue,
				ctr: v.ctr,
				conversionRate: v.convRate,
				shopId: v.shopId,
			})),
			skipDuplicates: true,
		});

		console.log(`\n✅ Done: ${exportData.length} inserted`);
	} catch (error) {
		console.error(`\n❌ Error:`, error instanceof Error ? error.message : error);
	}
}

/**
 * Parse CLI arguments
 */
function parseArgs(): BackfillOptions {
	const args = process.argv.slice(2);

	if (args.includes('--help')) {
		console.log(`
Usage: bun run scripts/backfill-statistics-fast.ts [options]

Options:
  --days N        Backfill last N days (default: 10)
  --start DATE    Start date (YYYY-MM-DD)
  --end DATE      End date (YYYY-MM-DD)
  --dry-run       Preview without making changes

Examples:
  bun run scripts/backfill-statistics-fast.ts --days 30
  bun run scripts/backfill-statistics-fast.ts --start 2025-11-01 --end 2025-11-30
  bun run scripts/backfill-statistics-fast.ts --days 10 --dry-run
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
		startDate = new Date(args[startIdx + 1]);
		endDate = new Date(args[endIdx + 1]);
	} else if (daysIdx >= 0) {
		const days = parseInt(args[daysIdx + 1], 10);
		endDate = new Date();
		endDate.setUTCDate(endDate.getUTCDate() - 1);
		endDate.setUTCHours(0, 0, 0, 0);

		startDate = new Date(endDate);
		startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
	} else {
		// Default: last 10 days
		endDate = new Date();
		endDate.setUTCDate(endDate.getUTCDate() - 1);
		endDate.setUTCHours(0, 0, 0, 0);

		startDate = new Date(endDate);
		startDate.setUTCDate(startDate.getUTCDate() - 9);
	}

	startDate.setUTCHours(0, 0, 0, 0);
	endDate.setUTCHours(0, 0, 0, 0);

	return { startDate, endDate, dryRun };
}

// Run
const options = parseArgs();
backfillStatisticsFast(options)
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
