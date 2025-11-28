#!/usr/bin/env bun
/**
 * Request scope update for Pummba
 * This will trigger Shopify to prompt the merchant to accept new scopes
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';

async function requestScopes() {
	console.log('🔐 Requesting Scope Update for Pummba\n');
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
			console.log('\n💡 Manual fix required:');
			console.log('   1. Go to: https://admin.shopify.com/store/64cc03-5f/apps');
			console.log('   2. Find "dreamshot-model-swap-pummba"');
			console.log('   3. Uninstall it');
			console.log('   4. Reinstall via Partner Dashboard or installation URL');
			return;
		}

		console.log('✅ Found session');
		console.log('   Access Token:', session.accessToken?.substring(0, 20) + '...');
		console.log('   Scope:', session.scope);

		console.log('\n🔍 Current session scopes:');
		const currentScopes = session.scope?.split(',') || [];
		currentScopes.forEach(scope => {
			console.log(`   - ${scope}`);
		});

		if (currentScopes.includes('read_customer_events')) {
			console.log('\n✅ Session already has read_customer_events!');
			console.log('   Trying pixel creation anyway...');
			
			// Try to create pixel
			const { app } = await getShopifyContextByShopDomain(SHOP_DOMAIN);
			const { admin } = await app.unauthenticated.admin(session.shop);
			
			try {
				const response = await admin.graphql(
					`
						mutation webPixelCreate($webPixel: WebPixelInput!) {
							webPixelCreate(webPixel: $webPixel) {
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
							webPixel: {
								settings: {
									app_url: process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io',
									enabled: 'true',
									debug: 'false',
								},
							},
						},
					},
				);

				const data = await response.json();
				console.log('\nResult:', JSON.stringify(data, null, 2));
			} catch (err) {
				console.log('\n❌ Still failed:', err instanceof Error ? err.message : err);
			}
		} else {
			console.log('\n❌ Session missing read_customer_events');
			console.log('\n🔧 REQUIRED ACTION:');
			console.log('   The shop owner MUST manually accept the new scope.');
			console.log('   Shopify does not allow apps to force scope updates.');
			console.log('\n📋 Steps:');
			console.log('   1. Shop owner logs into Shopify Admin');
			console.log('   2. Goes to: Apps → dreamshot-model-swap-pummba');
			console.log('   3. Looks for "Update permissions" or similar banner');
			console.log('   4. Clicks to accept');
			console.log('\n   OR:');
			console.log('   1. Uninstall the app');
			console.log('   2. Reinstall via:');
			console.log('      - Partner Dashboard → Apps → Test on development store');
			console.log('      - Direct URL: https://admin.shopify.com/store/64cc03-5f/oauth/install?client_id=21acdb3d10eb24f87b02129c68b89328');
		}

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
	}

	console.log('\n' + '='.repeat(60));
}

requestScopes()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
