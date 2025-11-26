#!/usr/bin/env bun
/**
 * Fix pixel app_url settings for all shops
 * Updates all connected pixels to use SHOPIFY_APP_URL
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APP_URL = process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io';

async function fixPixelAppUrls() {
	console.log('🔧 Fixing Pixel App URLs\n');
	console.log(`   Target URL: ${APP_URL}\n`);
	console.log('='.repeat(60));

	// Get all shops with sessions
	const sessions = await prisma.session.findMany({
		where: { accessToken: { not: '' } },
		select: { shop: true, accessToken: true },
		distinct: ['shop'],
	});

	console.log(`\nFound ${sessions.length} shops with sessions\n`);

	const results: Array<{
		shop: string;
		status: string;
		oldUrl?: string;
		newUrl?: string;
		error?: string;
	}> = [];

	for (const session of sessions) {
		console.log(`\n🏪 ${session.shop}`);
		console.log('-'.repeat(40));

		try {
			// Check current pixel settings
			const checkQuery = `{ webPixel { id settings } }`;
			const checkResponse = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': session.accessToken,
				},
				body: JSON.stringify({ query: checkQuery }),
			});

			const checkResult = await checkResponse.json();
			const pixel = checkResult.data?.webPixel;

			if (!pixel) {
				console.log('   ⏭️  No pixel connected');
				results.push({ shop: session.shop, status: 'no_pixel' });
				continue;
			}

			const currentSettings = JSON.parse(pixel.settings || '{}');
			const currentUrl = currentSettings.app_url || '';

			console.log(`   Current URL: ${currentUrl}`);

			if (currentUrl === APP_URL) {
				console.log('   ✅ Already correct');
				results.push({ shop: session.shop, status: 'already_correct', oldUrl: currentUrl });
				continue;
			}

			// Update pixel settings
			const mutation = `mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
				webPixelUpdate(id: $id, webPixel: $webPixel) {
					webPixel { id settings }
					userErrors { field message }
				}
			}`;

			const variables = {
				id: pixel.id,
				webPixel: {
					settings: JSON.stringify({
						...currentSettings,
						app_url: APP_URL,
					}),
				},
			};

			const updateResponse = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': session.accessToken,
				},
				body: JSON.stringify({ query: mutation, variables }),
			});

			const updateResult = await updateResponse.json();

			if (updateResult.data?.webPixelUpdate?.userErrors?.length > 0) {
				const error = updateResult.data.webPixelUpdate.userErrors[0].message;
				console.log(`   ❌ Error: ${error}`);
				results.push({ shop: session.shop, status: 'error', oldUrl: currentUrl, error });
				continue;
			}

			console.log(`   ✅ Updated: ${currentUrl} → ${APP_URL}`);
			results.push({ shop: session.shop, status: 'updated', oldUrl: currentUrl, newUrl: APP_URL });
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.log(`   ❌ Error: ${errorMsg}`);
			results.push({ shop: session.shop, status: 'error', error: errorMsg });
		}
	}

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('\n📊 Summary:\n');

	const updated = results.filter(r => r.status === 'updated');
	const alreadyCorrect = results.filter(r => r.status === 'already_correct');
	const noPixel = results.filter(r => r.status === 'no_pixel');
	const errors = results.filter(r => r.status === 'error');

	console.log(`✅ Updated: ${updated.length}`);
	console.log(`✓  Already correct: ${alreadyCorrect.length}`);
	console.log(`⏭️  No pixel: ${noPixel.length}`);
	console.log(`❌ Errors: ${errors.length}`);

	if (updated.length > 0) {
		console.log('\n✅ Updated shops:');
		updated.forEach(r => {
			console.log(`   - ${r.shop}: ${r.oldUrl} → ${r.newUrl}`);
		});
	}

	if (errors.length > 0) {
		console.log('\n❌ Failed shops:');
		errors.forEach(r => {
			console.log(`   - ${r.shop}: ${r.error}`);
		});
	}

	console.log('\n' + '='.repeat(60));

	await prisma.$disconnect();
}

fixPixelAppUrls()
	.then(() => {
		console.log('\n✅ Done');
		process.exit(0);
	})
	.catch(error => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
