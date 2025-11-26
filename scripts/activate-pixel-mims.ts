#!/usr/bin/env bun
/**
 * Activate web pixel specifically for MIMS shop
 */

import prisma from '../app/db.server';
import { findShopCredential } from '../app/services/shops.server';
import { getShopifyContextByShopDomain } from '../app/shopify.server';

// Always use SHOPIFY_APP_URL from env
const APP_URL = process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io';

type GraphQLFunction = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

async function checkPixelStatus(graphql: GraphQLFunction) {
	try {
		const response = await graphql(`
			query {
				webPixel {
					id
					settings
				}
			}
		`);

		const data = await response.json();
		console.log('  📊 GraphQL response:', JSON.stringify(data, null, 2));
		
		// Check for errors
		if (data.errors && data.errors.length > 0) {
			return {
				exists: false,
				error: data.errors[0].message,
				pixelId: null,
				settings: null,
			};
		}
		
		const pixel = data.data?.webPixel;

		return {
			exists: !!pixel,
			pixelId: pixel?.id || null,
			settings: pixel?.settings || null,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		// "No web pixel was found" means it doesn't exist yet - that's expected
		if (errorMsg.includes('No web pixel was found')) {
			console.log('  ℹ️  No pixel exists yet (this is expected)');
			return {
				exists: false,
				pixelId: null,
				settings: null,
			};
		}
		// Re-throw other errors
		throw error;
	}
}

async function createPixel(appUrl: string, graphql: GraphQLFunction) {
	console.log(`  📤 Creating pixel with appUrl: ${appUrl}`);
	
	const response = await graphql(
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
						app_url: appUrl,
						enabled: 'true',
						debug: 'false',
					},
				},
			},
		},
	);

	const result = await response.json();
	console.log('  📊 Create pixel response:', JSON.stringify(result, null, 2));

	if (result.data?.webPixelCreate?.userErrors?.length > 0) {
		const error = result.data.webPixelCreate.userErrors[0];
		return {
			success: false,
			error: error.message,
			code: error.code,
			alreadyExists: error.code === 'PIXEL_ALREADY_EXISTS' || error.message.includes('already exists'),
		};
	}

	if (result.data?.webPixelCreate?.webPixel?.id) {
		return {
			success: true,
			pixelId: result.data.webPixelCreate.webPixel.id,
			settings: result.data.webPixelCreate.webPixel.settings,
		};
	}

	return {
		success: false,
		error: 'No pixel ID returned',
		debug: result,
	};
}

async function activatePixelForMims() {
	console.log('🔌 Activating Web Pixel for MIMS\n');
	console.log('='.repeat(60));

	const shopDomain = 'hellomims.com';
	
	// Get credential
	const credential = await prisma.shopCredential.findFirst({
		where: { shopDomain },
	});

	if (!credential) {
		console.log('❌ No credential found for', shopDomain);
		process.exit(1);
	}

	console.log(`\n🏪 ${shopDomain}`);
	console.log(`   ID: ${credential.id}`);
	console.log(`   App URL: ${APP_URL}`);
	console.log(`   Scopes: ${credential.scopes.join(', ')}`);
	console.log('-'.repeat(60));

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
		process.exit(1);
	}

	console.log(`   Session: ${session.shop}`);

	// Get admin client
	const shopCredential = await findShopCredential({ shopId: credential.id });
	if (!shopCredential) {
		console.log('❌ Could not find shop credential by ID');
		process.exit(1);
	}

	const { app } = await getShopifyContextByShopDomain(shopCredential.shopDomain);
	const adminResult = await app.unauthenticated.admin(session.shop);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const graphql = (adminResult as any).admin.graphql;

	// Check required scopes
	const hasPixelScopes = shopCredential.scopes.includes('read_customer_events');
	console.log(`   Has read_customer_events scope: ${hasPixelScopes}`);

	if (!hasPixelScopes) {
		console.log('⚠️  Missing read_customer_events scope');
		process.exit(1);
	}

	// Check if pixel already exists
	console.log('\n📍 Checking pixel status...');
	const status = await checkPixelStatus(graphql);

	if (status.exists) {
		console.log(`✅ Pixel already active (ID: ${status.pixelId})`);
		process.exit(0);
	}

	if (status.error) {
		console.log(`⚠️  Status check returned error: ${status.error}`);
		console.log('   Attempting to create pixel anyway...');
	}

	// Create pixel using global APP_URL
	console.log('\n🔌 Creating pixel...');
	const createResult = await createPixel(APP_URL, graphql);

	if (createResult.success) {
		console.log(`\n✅ Pixel created successfully!`);
		console.log(`   Pixel ID: ${createResult.pixelId}`);
		process.exit(0);
	}

	if (createResult.alreadyExists) {
		console.log('⚠️  Pixel already exists');
		// Re-check to get the ID
		const recheckStatus = await checkPixelStatus(graphql);
		if (recheckStatus.exists) {
			console.log(`✅ Found existing pixel: ${recheckStatus.pixelId}`);
		}
		process.exit(0);
	}

	console.log(`\n❌ Failed to create pixel: ${createResult.error}`);
	process.exit(1);
}

activatePixelForMims().catch(error => {
	console.error('\n❌ Fatal error:', error);
	process.exit(1);
});
