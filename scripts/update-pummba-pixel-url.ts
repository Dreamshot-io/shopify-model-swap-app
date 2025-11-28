#!/usr/bin/env bun
/**
 * Update Pummba pixel URL to correct endpoint
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';
const PIXEL_ID = 'gid://shopify/WebPixel/3644621139';
const CORRECT_APP_URL = 'https://abtest.dreamshot.io';  // Production URL

async function updatePixelUrl() {
	console.log('🔧 Updating Pummba Pixel URL\n');
	console.log('='.repeat(60));
	console.log(`\nFrom: https://shopify.dreamshot.io`);
	console.log(`To:   ${CORRECT_APP_URL}\n`);
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

		console.log('\n🔨 Updating pixel settings...');

		const updateResponse = await admin.graphql(
			`
				mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
					webPixelUpdate(id: $id, webPixel: $webPixel) {
						userErrors {
							field
							message
							code
						}
						webPixel {
							id
							settings
						}
					}
				}
			`,
			{
				variables: {
					id: PIXEL_ID,
					webPixel: {
						settings: {
							app_url: CORRECT_APP_URL,
							enabled: 'true',
							debug: 'false',  // Disable debug in production
						},
					},
				},
			},
		);

		const updateData = await updateResponse.json();

		if (updateData.data?.webPixelUpdate?.userErrors?.length > 0) {
			console.log('\n❌ Error updating pixel:');
			updateData.data.webPixelUpdate.userErrors.forEach((error: any) => {
				console.log(`   - ${error.code}: ${error.message}`);
			});
			return;
		}

		if (updateData.data?.webPixelUpdate?.webPixel) {
			console.log('\n✅ SUCCESS! Pixel updated:');
			console.log('   ID:', updateData.data.webPixelUpdate.webPixel.id);
			console.log('   New Settings:', updateData.data.webPixelUpdate.webPixel.settings);
			
			console.log('\n🎯 Pixel is now configured correctly!');
			console.log('\n📊 Next steps:');
			console.log('   1. Run: bun run scripts/activate-pixel-all-shops.ts');
			console.log('   2. Should show pixel as active for Pummba');
			console.log('   3. Tracking should now work on storefront');
		} else {
			console.log('\n❓ Unexpected response:', JSON.stringify(updateData, null, 2));
		}

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
	}

	console.log('\n' + '='.repeat(60));
}

updatePixelUrl()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
