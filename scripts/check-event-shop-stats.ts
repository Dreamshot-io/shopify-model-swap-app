#!/usr/bin/env bun
import prisma from '../app/db.server';

async function check() {
	const withShop = await prisma.aBTestEvent.count({ where: { shopId: { not: null } } });
	const withoutShop = await prisma.aBTestEvent.count({ where: { shopId: null } });
	const total = await prisma.aBTestEvent.count();

	console.log('📊 Event Shop Stats\n');
	console.log(`Events with shopId:    ${withShop}`);
	console.log(`Events without shopId: ${withoutShop}`);
	console.log(`Total:                 ${total}`);

	// Check most recent events
	const recent = await prisma.aBTestEvent.findMany({
		orderBy: { createdAt: 'desc' },
		take: 5,
		select: { id: true, shopId: true, createdAt: true, productId: true },
	});
	console.log('\nMost recent 5 events:');
	recent.forEach((e) => {
		console.log(`  ${e.createdAt.toISOString()} | shopId: ${e.shopId || 'null'}`);
	});

	await prisma.$disconnect();
}
check();
