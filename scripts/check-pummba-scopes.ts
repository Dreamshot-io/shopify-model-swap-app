#!/usr/bin/env bun
/**
 * Check Pummba scope status
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';
const REQUIRED_SCOPES = ['write_pixels', 'read_customer_events'];

async function checkScopes() {
	console.log('🔍 Checking Pummba Scope Status\n');
	console.log('='.repeat(60));

	try {
		const credential = await prisma.shopCredential.findFirst({
			where: { shopDomain: SHOP_DOMAIN },
		});

		if (!credential) {
			console.log('❌ No credential found');
			return;
		}

		console.log('\n📋 Configured Scopes (in database):');
		console.log('   ' + credential.scopes.join(', '));

		console.log('\n🎯 Required Scopes for Pixel:');
		console.log('   ' + REQUIRED_SCOPES.join(', '));

		const missingScopes = REQUIRED_SCOPES.filter(
			scope => !credential.scopes.includes(scope)
		);

		if (missingScopes.length > 0) {
			console.log('\n❌ Missing scopes in database:');
			console.log('   ' + missingScopes.join(', '));
		} else {
			console.log('\n✅ All required scopes are configured');
		}

		// Try to query the actual granted scopes from Shopify
		console.log('\n🔍 Checking granted scopes from Shopify...');
		
		const session = await prisma.session.findFirst({
			where: {
				shopId: credential.id,
				isOnline: false,
			},
			orderBy: {
				expires: 'desc',
			},
		});

		if (!session) {
			console.log('❌ No session found - cannot check Shopify scopes');
			return;
		}

		const { app } = await getShopifyContextByShopDomain(SHOP_DOMAIN);
		const { admin } = await app.unauthenticated.admin(session.shop);

		try {
			const response = await admin.graphql(`
				query {
					appInstallation {
						id
						accessScopes {
							handle
							description
						}
					}
				}
			`);

			const data = await response.json();
			const grantedScopes = data.data?.appInstallation?.accessScopes || [];

			console.log('\n📊 Granted Scopes (from Shopify):');
			grantedScopes.forEach((scope: any) => {
				console.log(`   - ${scope.handle}`);
			});

			const grantedHandles = grantedScopes.map((s: any) => s.handle);
			const missingGranted = REQUIRED_SCOPES.filter(
				scope => !grantedHandles.includes(scope)
			);

			if (missingGranted.length > 0) {
				console.log('\n❌ MISSING GRANTED SCOPES:');
				console.log('   ' + missingGranted.join(', '));
				console.log('\n🔧 FIX: Shop needs to re-authorize the app');
				console.log('   1. Go to Shopify Admin → Apps → dreamshot-model-swap-pummba');
				console.log('   2. Look for "Update permissions" banner');
				console.log('   3. Click to accept new scopes');
				console.log('\n   OR uninstall and reinstall the app');
			} else {
				console.log('\n✅ All required scopes are granted by Shopify');
				console.log('   Pixel should work - investigating further...');
			}

		} catch (apiError) {
			console.log('\n⚠️  Could not query granted scopes from API');
			console.log('   Error:', apiError instanceof Error ? apiError.message : apiError);
		}

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
	}

	console.log('\n' + '='.repeat(60));
}

checkScopes()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
