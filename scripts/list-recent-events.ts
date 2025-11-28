#!/usr/bin/env bun
/**
 * List recent AB test events in a table format
 */

import prisma from '../app/db.server';

const DEFAULT_LIMIT = 50;

async function listRecentEvents() {
	const limit = parseInt(process.argv[2]) || DEFAULT_LIMIT;
	const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

	console.log(`📊 Recent AB Test Events (last ${limit})\n`);

	if (verbose) {
		console.log('ℹ️  Verbose mode: Showing product IDs\n');
	}

	try {
		const events = await prisma.aBTestEvent.findMany({
			take: limit,
			orderBy: {
				createdAt: 'desc',
			},
			include: {
				test: {
					include: {
						shopCredential: {
							select: {
								shopName: true,
								shopDomain: true,
							},
						},
					},
				},
				// Include direct shop relation (new field)
				shop: {
					select: {
						shopName: true,
						shopDomain: true,
					},
				},
			},
		});

		if (events.length === 0) {
			console.log('No events found in database.\n');
			console.log('💡 Events are created when:');
			console.log('   - Pixel tracks impressions on storefront');
			console.log('   - Users add products to cart');
			console.log('   - Purchases are completed\n');
			return;
		}

		// Build a shop lookup cache - get all shops and their recent product IDs from tests
		const shopProductMap = new Map<string, string>(); // productId -> shopDomain

		const allTests = await prisma.aBTest.findMany({
			where: {
				shopCredential: {
					isNot: null,
				},
			},
			select: {
				productId: true,
				shop: true, // Old field for backward compat
				shopCredential: {
					select: {
						shopDomain: true,
					},
				},
			},
		});

		allTests.forEach((test) => {
			if (test.productId && test.shopCredential?.shopDomain) {
				shopProductMap.set(test.productId, test.shopCredential.shopDomain);
			} else if (test.productId && test.shop) {
				// Fallback to old shop field
				shopProductMap.set(test.productId, test.shop);
			}
		});

		// Debug info in verbose mode
		if (verbose) {
			console.log(`[Debug] Mapped ${shopProductMap.size} products to shops from ${allTests.length} tests`);
			console.log(`[Debug] Analyzing ${events.length} events...\n`);
		}

		// Get shop name from multiple sources (priority order)
		const eventsWithShop = events.map((event) => {
			let shopName = 'Unknown';
			let testName = 'No test';
			const ev = event as any;

			// Priority 1: Direct shop relation (new field) - prefer shopName, fallback to domain
			if (ev.shop?.shopName) {
				shopName = ev.shop.shopName;
			} else if (ev.shop?.shopDomain) {
				shopName = ev.shop.shopDomain.replace('.myshopify.com', '');
			}
			// Priority 2: Test's shopCredential
			else if (ev.test?.shopCredential?.shopName) {
				shopName = ev.test.shopCredential.shopName;
			} else if (ev.test?.shopCredential?.shopDomain) {
				shopName = ev.test.shopCredential.shopDomain.replace('.myshopify.com', '');
			}
			// Priority 3: Test's old shop field
			else if (ev.test?.shop) {
				shopName = ev.test.shop.replace('.myshopify.com', '');
			}
			// Priority 4: ProductId lookup
			else if (event.productId && shopProductMap.has(event.productId)) {
				shopName = shopProductMap.get(event.productId)!.replace('.myshopify.com', '');
			}

			// Get test name if available
			if (ev.test) {
				testName = ev.test.name || `Test ${ev.test.id.substring(0, 8)}`;
			}

			return {
				...event,
				shopName,
				testName,
			};
		});

		const validEvents = eventsWithShop;

		// Calculate column widths
		const shopWidth = Math.max(15, ...validEvents.map((e) => e.shopName.length));
		const eventTypeWidth = Math.max(12, ...validEvents.map((e) => e.eventType.length));
		const timestampWidth = 19; // "YYYY-MM-DD HH:MM:SS"

		// Header
		const headerCols = verbose
			? [
					'SHOP'.padEnd(shopWidth),
					'EVENT TYPE'.padEnd(eventTypeWidth),
					'TIMESTAMP'.padEnd(timestampWidth),
					'TEST'.padEnd(20),
					'PRODUCT ID',
			  ]
			: ['SHOP'.padEnd(shopWidth), 'EVENT TYPE'.padEnd(eventTypeWidth), 'TIMESTAMP'.padEnd(timestampWidth), 'TEST'];

		const header = headerCols.join(' │ ');
		const separator = '─'.repeat(header.length);

		console.log(separator);
		console.log(header);
		console.log(separator);

		// Rows
		validEvents.forEach((event) => {
			const shop = event.shopName.padEnd(shopWidth);
			const eventType = event.eventType.padEnd(eventTypeWidth);
			const timestamp = event.createdAt.toISOString().replace('T', ' ').substring(0, 19).padEnd(timestampWidth);

			const cols = verbose
				? [shop, eventType, timestamp, event.testName.padEnd(20), event.productId]
				: [shop, eventType, timestamp, event.testName];

			console.log(cols.join(' │ '));
		});

		console.log(separator);

		// Summary stats
		console.log('\n📈 Summary:\n');

		const eventsByType = validEvents.reduce(
			(acc, event) => {
				acc[event.eventType] = (acc[event.eventType] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		Object.entries(eventsByType)
			.sort(([, a], [, b]) => b - a)
			.forEach(([type, count]) => {
				const bar = '█'.repeat(Math.ceil((count / validEvents.length) * 30));
				console.log(`  ${type.padEnd(15)} ${count.toString().padStart(4)}  ${bar}`);
			});

		const eventsByShop = validEvents.reduce(
			(acc, event) => {
				acc[event.shopName] = (acc[event.shopName] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		console.log('\n📍 By Shop:\n');
		Object.entries(eventsByShop)
			.sort(([, a], [, b]) => b - a)
			.forEach(([shopName, count]) => {
				const bar = '█'.repeat(Math.ceil((count / validEvents.length) * 30));
				console.log(`  ${shopName.padEnd(25)} ${count.toString().padStart(4)}  ${bar}`);
			});

		const now = new Date();
		const oldest = validEvents[validEvents.length - 1].createdAt;
		const timeSpan = Math.floor((now.getTime() - oldest.getTime()) / 1000 / 60);

		console.log(`\n⏱️  Time span: ${timeSpan} minutes`);
		console.log(`📅 Latest: ${validEvents[0].createdAt.toISOString()}`);
		console.log(`📅 Oldest: ${oldest.toISOString()}`);

		// Show explanation if many unknowns
		const unknownCount = validEvents.filter((e) => e.shopName === 'Unknown').length;
		if (unknownCount > 0) {
			console.log(`\n💡 ${unknownCount} event(s) show "Unknown" shop`);
			console.log(`   Run backfill: bun run scripts/backfill-event-shops.ts`);
			console.log(`   Use --verbose to see product IDs for debugging.`);
		}
	} catch (error) {
		console.error('❌ Error:', error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

listRecentEvents()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
