#!/usr/bin/env bun
/**
 * Check web pixel status for all shops
 */

import prisma from '../app/db.server';

async function checkAllPixels() {
	console.log('🔍 Checking Web Pixel Status\n');
	console.log('='.repeat(60));

	const shops = await prisma.shopCredential.findMany({
		where: { status: 'ACTIVE' },
		select: { id: true, shopDomain: true },
	});

	console.log(`\nFound ${shops.length} active shops\n`);

	for (const shop of shops) {
		console.log(`\n🏪 ${shop.shopDomain}`);
		console.log('-'.repeat(60));

		// Check if there are any AB test events for this shop
		const eventCount = await prisma.aBTestEvent.count({
			where: { test: { shop: shop.id } },
		});

		console.log(`  📊 Total AB Test Events: ${eventCount}`);

		if (eventCount > 0) {
			const recentEvent = await prisma.aBTestEvent.findFirst({
				where: { test: { shop: shop.id } },
				orderBy: { createdAt: 'desc' },
				select: { eventType: true, createdAt: true },
			});

			console.log(`  ✅ Pixel IS tracking events`);
			console.log(`     Last event: ${recentEvent?.eventType} at ${recentEvent?.createdAt.toISOString()}`);
		} else {
			console.log(`  ⚠️  No events tracked yet - pixel may not be configured`);
		}
	}

	console.log('\n' + '='.repeat(60));
	console.log('\n📋 Next Steps:\n');
	console.log('For shops with no events:');
	console.log('1. Visit Shopify Admin → Settings → Customer Events');
	console.log('2. Find "ab-test-pixel" and click on it');
	console.log('3. Configure with:');
	console.log('   - app_url: https://shopify.dreamshot.io');
	console.log('   - enabled: true');
	console.log('   - debug: false');
	console.log('4. Click "Connect" or "Save"\n');
}

checkAllPixels()
	.then(() => {
		console.log('✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Error:', error);
		process.exit(1);
	});
