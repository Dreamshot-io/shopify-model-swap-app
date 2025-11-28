#!/usr/bin/env bun
/**
 * Find existing pixel for Pummba
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';

async function findPixel() {
	console.log('🔍 Finding Existing Pixel for Pummba\n');
	console.log('='.repeat(60));

	try {
		const session = await prisma.session.findFirst({
			where: {
				shop: SHOP_DOMAIN,
				isOnline: false,
			},
			orderBy: {
				expires: 'desc',
			},
		});

		if (!session) {
			console.log('❌ No session found');
			return;
		}

		const { app } = await getShopifyContextByShopDomain(SHOP_DOMAIN);
		const { admin } = await app.unauthenticated.admin(session.shop);

		console.log('🔍 Querying all app-scoped extensions...\n');
		
		// Query currentAppInstallation which gives us app-scoped info
		const appQuery = await admin.graphql(`
			query {
				currentAppInstallation {
					id
					app {
						id
						title
					}
				}
			}
		`);

		const appData = await appQuery.json();
		console.log('App Installation:', JSON.stringify(appData, null, 2));

		// The webPixel query should work if it exists
		console.log('\n🔍 Trying to query webPixel (singular)...\n');
		try {
			const pixelQuery = await admin.graphql(`
				query {
					webPixel {
						id
						settings
					}
				}
			`);

			const pixelData = await pixelQuery.json();
			
			if (pixelData.data?.webPixel) {
				console.log('✅ FOUND PIXEL!');
				console.log('   ID:', pixelData.data.webPixel.id);
				console.log('   Settings:', JSON.stringify(pixelData.data.webPixel.settings, null, 2));
				
				console.log('\n🎯 PIXEL IS ALREADY ACTIVE!');
				console.log('   No activation needed.');
				console.log('\n📍 Check in Shopify Admin:');
				console.log('   https://admin.shopify.com/store/64cc03-5f/settings/customer_events');
			} else {
				console.log('Pixel query returned:', JSON.stringify(pixelData, null, 2));
			}
		} catch (pixelError) {
			console.log('❌ Pixel query error:', pixelError instanceof Error ? pixelError.message : pixelError);
		}

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
	}

	console.log('\n' + '='.repeat(60));
}

findPixel()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
