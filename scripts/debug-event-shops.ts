#!/usr/bin/env bun
import prisma from '../app/db.server';

async function debug() {
	console.log('🔍 Debugging Event Shop Detection\n');

	const shops = await prisma.shopCredential.findMany({
		where: { status: 'ACTIVE' },
		select: { shopDomain: true },
	});

	console.log(`Active shops: ${shops.length}`);
	shops.forEach((s) => console.log(`  - ${s.shopDomain}`));

	const tests = await prisma.aBTest.findMany({
		select: {
			id: true,
			name: true,
			productId: true,
			shopCredential: { select: { shopDomain: true } },
		},
	});

	console.log(`\nTests: ${tests.length}`);
	if (tests.length > 0) {
		tests.slice(0, 5).forEach((t) => console.log(`  - ${t.shopCredential?.shopDomain}: ${t.productId}`));
	} else {
		console.log('  (none)');
	}

	const recentEvent = await prisma.aBTestEvent.findFirst({
		orderBy: { createdAt: 'desc' },
		select: { productId: true, metadata: true },
	});

	console.log(`\nMost recent event:`);
	console.log(`  Product ID: ${recentEvent?.productId}`);
	console.log(`  Metadata: ${JSON.stringify(recentEvent?.metadata, null, 2)}`);

	if (recentEvent?.productId) {
		const matchingTest = await prisma.aBTest.findFirst({
			where: { productId: recentEvent.productId },
			select: { shopCredential: { select: { shopDomain: true } } },
		});

		console.log(`  Matching test shop: ${matchingTest?.shopCredential?.shopDomain || 'Not found'}`);
	}

	await prisma.$disconnect();
}

debug()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
