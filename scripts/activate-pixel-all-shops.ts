#!/usr/bin/env bun
/**
 * Activate web pixel for all shops
 * Creates/connects the AB Test Pixel extension for each active shop
 */

import prisma from '../app/db.server';
import { findShopCredential } from '../app/services/shops.server';
import { getShopifyContextByShopDomain } from '../app/shopify.server';

type GraphQLFunction = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

async function checkPixelStatus(graphql: GraphQLFunction) {
	const response = await graphql(`
		query {
			webPixel {
				id
				settings
			}
		}
	`);

	const data = await response.json();
	const pixel = data.data?.webPixel;

	return {
		exists: !!pixel,
		pixelId: pixel?.id || null,
		settings: pixel?.settings || null,
	};
}

async function createPixel(appUrl: string, graphql: GraphQLFunction) {
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

async function activatePixelForShop(shopDomain: string, shopId: string) {
	console.log(`\n🏪 ${shopDomain}`);
	console.log('-'.repeat(60));

	try {
		// Get credential for app URL
		const credential = await prisma.shopCredential.findUnique({
			where: { id: shopId },
		});

		if (!credential) {
			console.log('  ❌ No credential found');
			return { success: false, error: 'No credential' };
		}

		// Get session to find myshopify domain
		const session = await prisma.session.findFirst({
			where: {
				shopId: shopId,
				isOnline: false,
			},
			orderBy: {
				expires: 'desc',
			},
		});

		if (!session) {
			console.log('  ❌ No valid session found');
			return { success: false, error: 'No session' };
		}

		// Get admin client using shopId lookup (works with custom domains)
		const shopCredential = await findShopCredential({ shopId: shopId });
		if (!shopCredential) {
			console.log('  ❌ Could not find shop credential by ID');
			return { success: false, error: 'Credential lookup failed' };
		}

		const { app } = await getShopifyContextByShopDomain(shopCredential.shopDomain);
		const adminResult = await app.unauthenticated.admin(session.shop);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const graphql = (adminResult as any).admin.graphql;

		// Check required scopes
		const hasPixelScopes = shopCredential.scopes.includes('read_customer_events');

		if (!hasPixelScopes) {
			console.log('  ⚠️  Missing read_customer_events scope - shop needs to re-authorize');
			return { success: false, error: 'Missing read_customer_events scope' };
		}

		// Check if pixel already exists
		console.log('  📍 Checking pixel status...');
		const status = await checkPixelStatus(graphql);

		if (status.exists) {
			console.log(`  ✅ Pixel already active (ID: ${status.pixelId})`);
			return { success: true, alreadyExists: true, pixelId: status.pixelId };
		}
		console.log('  🔌 Creating pixel...');

		// Create pixel
		const createResult = await createPixel(credential.appUrl, graphql);

		if (createResult.success) {
			console.log(`  ✅ Pixel created successfully!`);
			console.log(`     Pixel ID: ${createResult.pixelId}`);
			return createResult;
		}

		if (createResult.alreadyExists) {
			console.log('  ⚠️  Pixel already exists (error from Shopify)');
			// Re-check to get the ID
			const recheckStatus = await checkPixelStatus(graphql);
			if (recheckStatus.exists) {
				console.log(`  ✅ Found existing pixel: ${recheckStatus.pixelId}`);
				return {
					success: true,
					alreadyExists: true,
					pixelId: recheckStatus.pixelId,
				};
			}
		}

		console.log(`  ❌ Failed: ${createResult.error}`);
		return createResult;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		console.log(`  ❌ Error: ${errorMsg}`);
		return { success: false, error: errorMsg };
	}
}

async function activateAllPixels() {
	console.log('🔌 Activating Web Pixels for All Shops\n');
	console.log('='.repeat(60));

	// Get all active shops
	const shops = await prisma.shopCredential.findMany({
		where: {
			status: 'ACTIVE',
		},
		select: {
			id: true,
			shopDomain: true,
			appUrl: true,
		},
	});

	console.log(`\nFound ${shops.length} active shops\n`);

	const results = [];

	for (const shop of shops) {
		const result = await activatePixelForShop(shop.shopDomain, shop.id);
		results.push({
			shopDomain: shop.shopDomain,
			...result,
		});
	}

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('\n📊 Summary:\n');

	const successful = results.filter(r => r.success);
	const failed = results.filter(r => !r.success);
	const alreadyExisted = results.filter(r => r.alreadyExists);

	console.log(`✅ Successful: ${successful.length}`);
	console.log(`⚠️  Already existed: ${alreadyExisted.length}`);
	console.log(`❌ Failed: ${failed.length}`);

	if (failed.length > 0) {
		console.log('\n❌ Failed shops:');
		failed.forEach(r => {
			console.log(`   - ${r.shopDomain}: ${r.error}`);
		});
	}

	console.log('\n' + '='.repeat(60));
}

activateAllPixels()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch(error => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
