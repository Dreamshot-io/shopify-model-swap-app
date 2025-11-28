#!/usr/bin/env bun
/**
 * Backfill shopId for ABTestEvents that don't have it
 * 
 * Strategy:
 * 1. If event has testId, get shopId from test's shopCredential
 * 2. If no testId, try to find shop from productId via existing tests
 * 3. Track statistics
 */

import prisma from '../app/db.server';

async function backfillEventShops() {
	console.log('🔄 Backfilling shopId for ABTestEvents\n');
	console.log('='.repeat(60));

	// Get all events without shopId
	const eventsWithoutShop = await prisma.aBTestEvent.count({
		where: { shopId: null },
	});

	console.log(`\n📊 Events without shopId: ${eventsWithoutShop}`);

	if (eventsWithoutShop === 0) {
		console.log('✅ No events need backfilling!');
		return;
	}

	// Build productId -> shopId map from tests AND ProductInfo
	const productToShopMap = new Map<string, string>();

	// Source 1: ABTests
	const tests = await prisma.aBTest.findMany({
		where: {
			shopId: { not: null },
		},
		select: {
			productId: true,
			shopId: true,
		},
	});
	tests.forEach(test => {
		if (test.productId && test.shopId) {
			productToShopMap.set(test.productId, test.shopId);
		}
	});
	console.log(`📦 Mapped ${productToShopMap.size} products from ABTests`);

	// Source 2: ProductInfo (for products that don't have tests)
	const productInfos = await prisma.productInfo.findMany({
		select: {
			productId: true,
			shopId: true,
		},
		distinct: ['productId'],
	});
	let addedFromProductInfo = 0;
	productInfos.forEach(pi => {
		if (pi.productId && pi.shopId && !productToShopMap.has(pi.productId)) {
			productToShopMap.set(pi.productId, pi.shopId);
			addedFromProductInfo++;
		}
	});
	console.log(`📦 Added ${addedFromProductInfo} more products from ProductInfo`);
	console.log(`📦 Total: ${productToShopMap.size} products mapped to shops\n`);

	// Process in batches
	const BATCH_SIZE = 100;
	let processed = 0;
	let updatedViaTest = 0;
	let updatedViaProduct = 0;
	let unresolved = 0;

	while (true) {
		// Get batch of events without shopId
		const events = await prisma.aBTestEvent.findMany({
			where: { shopId: null },
			take: BATCH_SIZE,
			include: {
				test: {
					select: {
						shopId: true,
					},
				},
			},
		});

		if (events.length === 0) break;

		for (const event of events) {
			let shopId: string | null = null;

			// Method 1: Get from test relation
			if (event.test?.shopId) {
				shopId = event.test.shopId;
				updatedViaTest++;
			}
			// Method 2: Get from productId map
			else if (event.productId && productToShopMap.has(event.productId)) {
				shopId = productToShopMap.get(event.productId)!;
				updatedViaProduct++;
			}

			if (shopId) {
				await prisma.aBTestEvent.update({
					where: { id: event.id },
					data: { shopId },
				});
			} else {
				unresolved++;
			}

			processed++;
		}

		console.log(`  Processed: ${processed}/${eventsWithoutShop}`);
	}

	console.log('\n' + '='.repeat(60));
	console.log('\n📈 Backfill Results:\n');
	console.log(`  ✅ Updated via test relation: ${updatedViaTest}`);
	console.log(`  ✅ Updated via productId map: ${updatedViaProduct}`);
	console.log(`  ⚠️  Unresolved (no shop found): ${unresolved}`);
	console.log(`  📊 Total processed: ${processed}`);

	// Verify final count
	const remainingWithoutShop = await prisma.aBTestEvent.count({
		where: { shopId: null },
	});
	console.log(`\n📊 Events still without shopId: ${remainingWithoutShop}`);
}

backfillEventShops()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Error:', error);
		process.exit(1);
	});
