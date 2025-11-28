#!/usr/bin/env bun
/**
 * Check Pummba pixel deployment status
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';

async function checkPixelDeployment() {
	console.log('🔍 Checking Pummba Pixel Deployment\n');
	console.log('='.repeat(60));

	try {
		const { app } = await getShopifyContextByShopDomain(SHOP_DOMAIN);
		const { admin } = await app.unauthenticated.admin(SHOP_DOMAIN);

		// Check app installation details
		console.log('\n📦 App Installation Check:');
		const appInstallationQuery = await admin.graphql(`
			query {
				appInstallation {
					id
					app {
						id
						handle
					}
					activeSubscriptions {
						id
						name
						status
					}
				}
			}
		`);

		const appInstallData = await appInstallationQuery.json();
		console.log('App Installation:', JSON.stringify(appInstallData, null, 2));

		// Try alternate query for pixels
		console.log('\n🔌 Checking Pixel via Current API:');
		try {
			const currentPixelQuery = await admin.graphql(`
				query {
					currentAppInstallation {
						id
						publication {
							id
							name
						}
					}
				}
			`);
			const currentPixelData = await currentPixelQuery.json();
			console.log('Current Installation:', JSON.stringify(currentPixelData, null, 2));
		} catch (err) {
			console.log('Could not query current installation:', err instanceof Error ? err.message : err);
		}

		// Try to query OUR pixel specifically
		console.log('\n🎯 Checking Our Pixel:');
		const ourPixelQuery = await admin.graphql(`
			query {
				webPixel {
					id
					settings
				}
			}
		`);

		const ourPixelData = await ourPixelQuery.json();
		console.log('Our Pixel:', JSON.stringify(ourPixelData, null, 2));

		// Check if the extension is available
		console.log('\n🧩 Checking Available Extensions:');
		
		// This will tell us if the extension exists but isn't activated
		const extensionsQuery = await admin.graphql(`
			query {
				app {
					id
					handle
					installation {
						id
					}
				}
			}
		`);

		const extensionsData = await extensionsQuery.json();
		console.log('App/Extensions:', JSON.stringify(extensionsData, null, 2));

	} catch (error) {
		console.error('❌ Error:', error instanceof Error ? error.message : error);
		if (error instanceof Error && error.stack) {
			console.error('Stack:', error.stack);
		}
	}

	console.log('\n' + '='.repeat(60));
	console.log('\n📋 Next Steps:\n');
	console.log('1. If no pixels found: Extension not deployed to this shop');
	console.log('2. If pixel exists but disconnected: Run activation script');
	console.log('3. If extension not available: Need to redeploy app');
	console.log('4. If app version is old: Shop needs to accept new version\n');
}

checkPixelDeployment()
	.then(() => {
		console.log('✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
