#!/usr/bin/env bun
/**
 * Backfill shop names from Shopify for all ShopCredential records
 *
 * Usage:
 *   bun run scripts/backfill-shop-names.ts [options]
 *
 * Options:
 *   --shop <domain>     Update only this shop
 *   --dry-run           Preview changes without modifying database
 *   --help              Show this help message
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BackfillOptions {
	shop?: string;
	dryRun: boolean;
}

interface BackfillResult {
	shop: string;
	shopName: string | null;
	success: boolean;
	error?: string;
}

function parseArgs(): BackfillOptions {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
Backfill Shop Names - Fetches shop names from Shopify API

Usage: bun run scripts/backfill-shop-names.ts [options]

Options:
  --shop <domain>     Update only this shop (e.g., haanbrand.com)
  --dry-run           Preview changes without modifying database
  --help              Show this help message

Examples:
  # Backfill all shops
  bun run scripts/backfill-shop-names.ts

  # Backfill specific shop
  bun run scripts/backfill-shop-names.ts --shop haanbrand.com

  # Preview changes
  bun run scripts/backfill-shop-names.ts --dry-run
		`);
		process.exit(0);
	}

	const shopIdx = args.indexOf('--shop');
	const shop = shopIdx >= 0 ? args[shopIdx + 1] : undefined;
	const dryRun = args.includes('--dry-run');

	return { shop, dryRun };
}

async function getShopifyGraphQL(shopDomain: string) {
	const credential = await prisma.shopCredential.findUnique({
		where: { shopDomain },
	});

	if (!credential) {
		throw new Error(`No credential found for shop: ${shopDomain}`);
	}

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
		throw new Error(`No valid session found for shopId: ${credential.id} (${shopDomain})`);
	}

	const myshopifyDomain = session.shop;
	const accessToken = session.accessToken;

	// Convert API version format (January25 -> 2025-01)
	const versionMap: Record<string, string> = {
		January25: '2025-01',
		January24: '2024-01',
		April24: '2024-04',
		July24: '2024-07',
		October24: '2024-10',
	};
	const rawVersion = credential.apiVersion || 'January25';
	const apiVersion = versionMap[rawVersion] || '2024-01';

	const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
		const response = await fetch(`https://${myshopifyDomain}/admin/api/${apiVersion}/graphql.json`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': accessToken,
			},
			body: JSON.stringify({
				query,
				variables: options?.variables || {},
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`GraphQL request failed: ${response.status} ${text}`);
		}

		return response.json();
	};

	return { graphql, credential };
}

async function fetchShopName(shopDomain: string): Promise<string | null> {
	const { graphql } = await getShopifyGraphQL(shopDomain);

	const data = (await graphql(`
		query GetShopName {
			shop {
				name
			}
		}
	`)) as { data?: { shop?: { name: string } } };

	return data.data?.shop?.name || null;
}

async function backfillShop(shopDomain: string, options: BackfillOptions): Promise<BackfillResult> {
	try {
		const shopName = await fetchShopName(shopDomain);

		if (!shopName) {
			return {
				shop: shopDomain,
				shopName: null,
				success: false,
				error: 'Could not fetch shop name from Shopify',
			};
		}

		if (options.dryRun) {
			console.log(`   [DRY-RUN] Would update ${shopDomain} → "${shopName}"`);
		} else {
			await prisma.shopCredential.update({
				where: { shopDomain },
				data: { shopName },
			});
			console.log(`   ✓ ${shopDomain} → "${shopName}"`);
		}

		return {
			shop: shopDomain,
			shopName,
			success: true,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.log(`   ✗ ${shopDomain}: ${msg}`);
		return {
			shop: shopDomain,
			shopName: null,
			success: false,
			error: msg,
		};
	}
}

async function main() {
	const options = parseArgs();

	console.log('🏪 Backfill Shop Names');
	console.log('='.repeat(60));
	console.log(`Mode: ${options.dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
	if (options.shop) {
		console.log(`Shop filter: ${options.shop}`);
	}
	console.log('='.repeat(60));

	// Get shops to update
	const shops = await prisma.shopCredential.findMany({
		where: {
			status: 'ACTIVE',
			...(options.shop ? { shopDomain: options.shop } : {}),
		},
		select: {
			id: true,
			shopDomain: true,
			shopName: true,
		},
	});

	if (shops.length === 0) {
		console.log('\n❌ No active shops found');
		if (options.shop) {
			console.log(`   Check if shop "${options.shop}" exists and is ACTIVE`);
		}
		process.exit(1);
	}

	// Filter to shops without names (unless forcing all)
	const shopsToUpdate = shops.filter((s) => !s.shopName);
	console.log(`\n📋 Found ${shops.length} active shop(s), ${shopsToUpdate.length} need names\n`);

	if (shopsToUpdate.length === 0) {
		console.log('✅ All shops already have names');
		process.exit(0);
	}

	const results: BackfillResult[] = [];

	for (const shop of shopsToUpdate) {
		const result = await backfillShop(shop.shopDomain, options);
		results.push(result);
	}

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('📊 SUMMARY');
	console.log('='.repeat(60));

	const successful = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);

	console.log(`Total:      ${results.length}`);
	console.log(`Successful: ${successful.length}`);
	console.log(`Failed:     ${failed.length}`);

	if (failed.length > 0) {
		console.log('\nFailed shops:');
		failed.forEach((r) => console.log(`  - ${r.shop}: ${r.error}`));
	}

	console.log('='.repeat(60));

	if (options.dryRun) {
		console.log('\n⚠️  This was a DRY RUN - no changes were made');
	}

	console.log('\n✅ Backfill complete');
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
