#!/usr/bin/env bun
/**
 * Link existing sessions to ShopCredentials
 * Fixes shopId FK for sessions that weren't properly linked during installation
 */

import prisma from '../app/db.server';

async function linkSessions() {
	console.log('🔗 Linking Sessions to ShopCredentials\n');
	console.log('='.repeat(60));

	// Get all sessions without shopId
	const unlinkedSessions = await prisma.session.findMany({
		where: {
			shopId: null,
		},
		select: {
			id: true,
			shop: true,
			isOnline: true,
			accessToken: true,
		},
	});

	console.log(`\nFound ${unlinkedSessions.length} unlinked sessions\n`);

	let linked = 0;
	let failed = 0;

	for (const session of unlinkedSessions) {
		console.log(`📍 Session: ${session.shop} (${session.isOnline ? 'online' : 'offline'})`);

		// For offline sessions, try to fetch shop info via API
		if (!session.isOnline) {
			try {
				const response = await fetch(
					`https://${session.shop}/admin/api/2025-01/graphql.json`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Shopify-Access-Token': session.accessToken,
						},
						body: JSON.stringify({
							query: '{ shop { myshopifyDomain primaryDomain { host } } }',
						}),
					},
				);

				const data = await response.json();

				if (data.data?.shop) {
					const myshopifyDomain = data.data.shop.myshopifyDomain;
					const primaryDomain = data.data.shop.primaryDomain.host;

					console.log(`  Myshopify: ${myshopifyDomain}`);
					console.log(`  Primary: ${primaryDomain}`);

					// Try to find matching credential by primary domain or myshopify domain
					const credential = await prisma.shopCredential.findFirst({
						where: {
							OR: [
								{ shopDomain: primaryDomain },
								{ shopDomain: primaryDomain.replace(/^www\./, '') },
								{ shopDomain: myshopifyDomain },
								{ customDomain: myshopifyDomain },
							],
						},
					});

					if (credential) {
						await prisma.session.update({
							where: { id: session.id },
							data: { shopId: credential.id },
						});
						console.log(`  ✅ Linked to ShopCredential: ${credential.shopDomain}\n`);
						linked++;
					} else {
						console.log(`  ⚠️  No matching ShopCredential found\n`);
						failed++;
					}
				} else {
					console.log(`  ❌ API error:`, data.errors?.[0]?.message || 'Unknown error\n');
					failed++;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				console.log(`  ❌ Error: ${errorMsg}\n`);
				failed++;
			}
		} else {
			// For online sessions, just try to match by shop domain
			const credential = await prisma.shopCredential.findFirst({
				where: {
					OR: [{ shopDomain: session.shop }, { customDomain: session.shop }],
				},
			});

			if (credential) {
				await prisma.session.update({
					where: { id: session.id },
					data: { shopId: credential.id },
				});
				console.log(`  ✅ Linked to ShopCredential: ${credential.shopDomain}\n`);
				linked++;
			} else {
				console.log(`  ⚠️  No matching ShopCredential found\n`);
				failed++;
			}
		}
	}

	console.log('='.repeat(60));
	console.log(`\n✅ Linked: ${linked}`);
	console.log(`⚠️  Failed: ${failed}`);
	console.log(`📊 Total: ${unlinkedSessions.length}\n`);
}

linkSessions()
	.then(() => {
		console.log('✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
