#!/usr/bin/env bun
/**
 * Force create pixel for Pummba shop
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const SHOP_DOMAIN = '64cc03-5f.myshopify.com';
const APP_URL = process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io';

async function forceCreatePixel() {
	console.log('🔌 Force Creating Pixel for Pummba\n');
	console.log('='.repeat(60));

	try {
		// Get shop credential
		const credential = await prisma.shopCredential.findFirst({
			where: { shopDomain: SHOP_DOMAIN },
		});

		if (!credential) {
			console.log('❌ No credential found for', SHOP_DOMAIN);
			return;
		}

		console.log('✅ Found credential:', credential.id);
		console.log('   App Handle:', credential.appHandle);
		console.log('   Scopes:', credential.scopes.join(', '));

		// Get session
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
			console.log('❌ No valid session found');
			return;
		}

		console.log('✅ Found session:', session.id);

		// Get admin client
		const { app } = await getShopifyContextByShopDomain(SHOP_DOMAIN);
		const adminResult = await app.unauthenticated.admin(session.shop);
		const graphql = (adminResult as any).admin.graphql;

		console.log('\n🔍 Step 1: Check current pixel status...');
		try {
			const checkResponse = await graphql(`
				query {
					webPixel {
						id
						settings
					}
				}
			`);

			const checkData = await checkResponse.json();
			console.log('Check result:', JSON.stringify(checkData, null, 2));

			if (checkData.data?.webPixel) {
				console.log('✅ Pixel already exists!');
				console.log('   ID:', checkData.data.webPixel.id);
				console.log('   Settings:', checkData.data.webPixel.settings);
				return;
			}
		} catch (checkError) {
			const errorMsg = checkError instanceof Error ? checkError.message : String(checkError);
			console.log('📝 Check error:', errorMsg);
			
			if (errorMsg.includes('No web pixel was found')) {
				console.log('✅ This is expected - pixel not created yet');
				console.log('🔨 Proceeding to create pixel...\n');
			} else {
				console.log('❌ Unexpected error - aborting');
				throw checkError;
			}
		}

		console.log('\n🔨 Step 2: Creating pixel...');
		const createResponse = await graphql(
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
							app_url: APP_URL,
							enabled: 'true',
							debug: 'false',
						},
					},
				},
			},
		);

		const createData = await createResponse.json();
		console.log('Create result:', JSON.stringify(createData, null, 2));

		if (createData.data?.webPixelCreate?.userErrors?.length > 0) {
			const error = createData.data.webPixelCreate.userErrors[0];
			console.log('\n❌ Error creating pixel:');
			console.log('   Code:', error.code);
			console.log('   Message:', error.message);
			console.log('   Field:', error.field);

			if (error.code === 'PIXEL_ALREADY_EXISTS') {
				console.log('\n💡 Pixel exists - try checking Shopify Admin manually');
				console.log('   URL: https://admin.shopify.com/store/64cc03-5f/settings/customer_events');
			}

			return;
		}

		if (createData.data?.webPixelCreate?.webPixel?.id) {
			console.log('\n✅ SUCCESS! Pixel created:');
			console.log('   ID:', createData.data.webPixelCreate.webPixel.id);
			console.log('   Settings:', createData.data.webPixelCreate.webPixel.settings);
			console.log('\n📍 Next: Check Shopify Admin → Settings → Customer Events');
			return;
		}

		console.log('\n❓ Unexpected response - no pixel ID returned');

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
		if (error instanceof Error && error.stack) {
			console.error('Stack:', error.stack);
		}
	}

	console.log('\n' + '='.repeat(60));
}

forceCreatePixel()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
