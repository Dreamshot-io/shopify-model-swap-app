#!/usr/bin/env bun
/**
 * Sync product media info from all Shopify shops to ProductInfo table
 * - Fetches all products and their media from Shopify
 * - Creates/updates ProductInfo records
 * - Backs up images to R2
 * - Soft-deletes removed media
 *
 * Usage:
 *   bun run scripts/sync-product-info.ts [options]
 *
 * Options:
 *   --shop <domain>     Sync only this shop (e.g., haanbrand.com)
 *   --dry-run           Preview changes without modifying database or R2
 *   --force-backup      Re-backup all images even if r2Url exists
 *   --help              Show this help message
 *
 * Examples:
 *   bun run scripts/sync-product-info.ts
 *   bun run scripts/sync-product-info.ts --shop haanbrand.com
 *   bun run scripts/sync-product-info.ts --dry-run
 *   bun run scripts/sync-product-info.ts --shop haanbrand.com --force-backup
 */

import prisma from '../app/db.server';
import { unauthenticated } from '../app/shopify.server';
import { uploadImageFromUrlToR2 } from '../app/services/storage.server';

interface SyncOptions {
	shop?: string;
	dryRun: boolean;
	forceBackup: boolean;
}

interface SyncResult {
	shop: string;
	shopId: string;
	productsProcessed: number;
	mediaFound: number;
	created: number;
	updated: number;
	softDeleted: number;
	backedUp: number;
	errors: string[];
}

interface ShopifyMedia {
	id: string;
	alt: string | null;
	image?: {
		url: string;
		altText: string | null;
	};
}

interface ShopifyProduct {
	id: string;
	title: string;
	handle: string;
	status: string;
	media: {
		nodes: ShopifyMedia[];
	};
}

function parseArgs(): SyncOptions {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
Sync Product Info - Syncs Shopify product media to ProductInfo table

Usage: bun run scripts/sync-product-info.ts [options]

Options:
  --shop <domain>     Sync only this shop (e.g., haanbrand.com)
  --dry-run           Preview changes without modifying database or R2
  --force-backup      Re-backup all images even if r2Url exists
  --help              Show this help message

Examples:
  # Sync all shops
  bun run scripts/sync-product-info.ts

  # Sync specific shop
  bun run scripts/sync-product-info.ts --shop haanbrand.com

  # Preview changes
  bun run scripts/sync-product-info.ts --dry-run

  # Force re-backup all images for a shop
  bun run scripts/sync-product-info.ts --shop haanbrand.com --force-backup
		`);
		process.exit(0);
	}

	const shopIdx = args.indexOf('--shop');
	const shop = shopIdx >= 0 ? args[shopIdx + 1] : undefined;
	const dryRun = args.includes('--dry-run');
	const forceBackup = args.includes('--force-backup');

	return { shop, dryRun, forceBackup };
}

async function getShopifyAdmin(shopDomain: string) {
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

	// Create a simple GraphQL client using the session's access token
	// This bypasses the unauthenticated.admin lookup which has issues with custom domains
	const myshopifyDomain = session.shop;
	const accessToken = session.accessToken;
	
	// Convert API version format (January25 -> 2025-01)
	const versionMap: Record<string, string> = {
		'January25': '2025-01',
		'January24': '2024-01',
		'April24': '2024-04',
		'July24': '2024-07',
		'October24': '2024-10',
	};
	const rawVersion = credential.apiVersion || 'January25';
	const apiVersion = versionMap[rawVersion] || '2024-01';

	const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
		const response = await fetch(
			`https://${myshopifyDomain}/admin/api/${apiVersion}/graphql.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': accessToken,
				},
				body: JSON.stringify({
					query,
					variables: options?.variables || {},
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`GraphQL request failed: ${response.status} ${text}`);
		}

		return {
			json: async () => response.json(),
		};
	};

	return {
		graphql,
		session,
		credential,
	};
}

async function fetchAllProducts(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	graphql: any,
): Promise<ShopifyProduct[]> {
	const products: ShopifyProduct[] = [];
	let hasNextPage = true;
	let cursor: string | null = null;

	while (hasNextPage) {
		const response: { json: () => Promise<unknown> } = await graphql(
			`#graphql
				query GetProductsWithMedia($first: Int!, $after: String) {
					products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
						pageInfo {
							hasNextPage
							endCursor
						}
						edges {
							node {
								id
								title
								handle
								status
								media(first: 50) {
									nodes {
										id
										alt
										... on MediaImage {
											image {
												url
												altText
											}
										}
									}
								}
							}
						}
					}
				}`,
			{ variables: { first: 50, after: cursor } },
		);

		const data = (await response.json()) as {
			data?: {
				products?: {
					pageInfo?: { hasNextPage: boolean; endCursor: string };
					edges?: Array<{ node: ShopifyProduct }>;
				};
			};
		};
		const pageInfo = data.data?.products?.pageInfo;
		const edges = data.data?.products?.edges || [];

		products.push(...edges.map((edge: { node: ShopifyProduct }) => edge.node));

		hasNextPage = pageInfo?.hasNextPage || false;
		cursor = pageInfo?.endCursor || null;
	}

	return products;
}

function extractExtension(url: string): string {
	const urlPath = url.split('?')[0];
	const urlParts = urlPath.split('.');
	const lastPart = urlParts[urlParts.length - 1]?.toLowerCase();

	if (lastPart && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(lastPart)) {
		return lastPart;
	}
	return 'jpg';
}

async function syncShopProducts(
	shopId: string,
	shopDomain: string,
	options: SyncOptions,
): Promise<SyncResult> {
	const result: SyncResult = {
		shop: shopDomain,
		shopId,
		productsProcessed: 0,
		mediaFound: 0,
		created: 0,
		updated: 0,
		softDeleted: 0,
		backedUp: 0,
		errors: [],
	};

	try {
		console.log(`\n📦 Fetching products from Shopify...`);
		const { graphql } = await getShopifyAdmin(shopDomain);
		const products = await fetchAllProducts(graphql);
		result.productsProcessed = products.length;
		console.log(`   Found ${products.length} products`);

		// Collect all media IDs from Shopify
		const shopifyMediaIds = new Set<string>();
		const mediaMap = new Map<string, { productId: string; productTitle: string; productHandle: string; shopifyUrl: string; altText: string | null }>();

		for (const product of products) {
			for (const media of product.media.nodes) {
				if (media.image?.url) {
					shopifyMediaIds.add(media.id);
					mediaMap.set(media.id, {
						productId: product.id,
						productTitle: product.title,
						productHandle: product.handle,
						shopifyUrl: media.image.url,
						altText: media.image.altText,
					});
				}
			}
		}

		result.mediaFound = shopifyMediaIds.size;
		console.log(`   Found ${shopifyMediaIds.size} media items`);

		// Get existing ProductInfo records
		const existingRecords = await prisma.productInfo.findMany({
			where: {
				shopId,
				deletedAt: null,
			},
		});

		const existingMediaIds = new Set(existingRecords.map((r) => r.mediaId).filter(Boolean) as string[]);
		console.log(`   Existing records: ${existingRecords.length}`);

		// Process each media item
		console.log(`\n🔄 Processing media items...`);

		for (const [mediaId, info] of mediaMap) {
			const existing = existingRecords.find((r) => r.mediaId === mediaId);

			if (existing) {
				// Update if URL changed
				const needsUpdate = existing.shopifyUrl !== info.shopifyUrl;
				const needsBackup = options.forceBackup || !existing.r2Url;

				if (needsUpdate || needsBackup) {
					if (options.dryRun) {
						console.log(`   [DRY-RUN] Would update: ${mediaId}`);
						result.updated++;
					} else {
						try {
							let r2Url = existing.r2Url;
							let r2Key = existing.r2Key;

							if (needsBackup && info.shopifyUrl) {
								const ext = extractExtension(info.shopifyUrl);
								const keyPrefix = `product-images/${shopId}/${info.productId}/`;
								r2Url = await uploadImageFromUrlToR2(info.shopifyUrl, {
									keyPrefix,
									productId: info.productId,
								});
								r2Key = `${keyPrefix}${mediaId}.${ext}`;
								result.backedUp++;
							}

							await prisma.productInfo.update({
								where: { id: existing.id },
								data: {
									shopifyUrl: info.shopifyUrl,
									productId: info.productId,
									productTitle: info.productTitle,
									productHandle: info.productHandle,
									r2Url,
									r2Key,
									backedUpAt: needsBackup ? new Date() : existing.backedUpAt,
								},
							});
							result.updated++;
						} catch (error) {
							const msg = error instanceof Error ? error.message : 'Unknown error';
							result.errors.push(`Update ${mediaId}: ${msg}`);
						}
					}
				}
			} else {
				// Create new record
				if (options.dryRun) {
					console.log(`   [DRY-RUN] Would create: ${mediaId}`);
					result.created++;
				} else {
					try {
						let r2Url: string | null = null;
						let r2Key: string | null = null;

						if (info.shopifyUrl) {
							const ext = extractExtension(info.shopifyUrl);
							const keyPrefix = `product-images/${shopId}/${info.productId}/`;
							r2Url = await uploadImageFromUrlToR2(info.shopifyUrl, {
								keyPrefix,
								productId: info.productId,
							});
							r2Key = `${keyPrefix}${mediaId}.${ext}`;
							result.backedUp++;
						}

						await prisma.productInfo.upsert({
							where: {
								shopId_mediaId: {
									shopId,
									mediaId,
								},
							},
							create: {
								shopId,
								productId: info.productId,
								productTitle: info.productTitle,
								productHandle: info.productHandle,
								mediaId,
								shopifyUrl: info.shopifyUrl,
								r2Url,
								r2Key,
								backedUpAt: r2Url ? new Date() : null,
							},
							update: {
								productId: info.productId,
								productTitle: info.productTitle,
								productHandle: info.productHandle,
								shopifyUrl: info.shopifyUrl,
								r2Url,
								r2Key,
								backedUpAt: r2Url ? new Date() : undefined,
								deletedAt: null,
							},
						});
						result.created++;
					} catch (error) {
						const msg = error instanceof Error ? error.message : 'Unknown error';
						result.errors.push(`Create ${mediaId}: ${msg}`);
					}
				}
			}
		}

		// Soft-delete records for media no longer in Shopify
		const mediaIdsToDelete = [...existingMediaIds].filter((id) => !shopifyMediaIds.has(id));
		if (mediaIdsToDelete.length > 0) {
			console.log(`\n🗑️  Soft-deleting ${mediaIdsToDelete.length} removed media items...`);

			if (options.dryRun) {
				console.log(`   [DRY-RUN] Would soft-delete: ${mediaIdsToDelete.join(', ')}`);
				result.softDeleted = mediaIdsToDelete.length;
			} else {
				for (const mediaId of mediaIdsToDelete) {
					try {
						await prisma.productInfo.updateMany({
							where: {
								shopId,
								mediaId,
								deletedAt: null,
							},
							data: {
								deletedAt: new Date(),
							},
						});
						result.softDeleted++;
					} catch (error) {
						const msg = error instanceof Error ? error.message : 'Unknown error';
						result.errors.push(`Soft-delete ${mediaId}: ${msg}`);
					}
				}
			}
		}

		return result;
	} catch (error) {
		console.error(`   ❌ Error:`, error);
		const msg = error instanceof Error ? error.message : String(error);
		result.errors.push(`Shop sync failed: ${msg}`);
		return result;
	}
}

async function main() {
	const options = parseArgs();

	console.log('🔄 Product Info Sync');
	console.log('='.repeat(60));
	console.log(`Mode:         ${options.dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
	console.log(`Force backup: ${options.forceBackup ? 'YES' : 'NO'}`);
	if (options.shop) {
		console.log(`Shop filter:  ${options.shop}`);
	}
	console.log('='.repeat(60));

	// Get active shops
	const shops = await prisma.shopCredential.findMany({
		where: {
			status: 'ACTIVE',
			...(options.shop ? { shopDomain: options.shop } : {}),
		},
		select: {
			id: true,
			shopDomain: true,
		},
	});

	if (shops.length === 0) {
		console.log('\n❌ No active shops found');
		if (options.shop) {
			console.log(`   Check if shop "${options.shop}" exists and is ACTIVE`);
		}
		process.exit(1);
	}

	console.log(`\n🏪 Found ${shops.length} active shop(s)\n`);

	const results: SyncResult[] = [];

	for (const shop of shops) {
		console.log('\n' + '─'.repeat(60));
		console.log(`🏪 Shop: ${shop.shopDomain}`);
		console.log('─'.repeat(60));

		const result = await syncShopProducts(shop.id, shop.shopDomain, options);
		results.push(result);

		// Print shop summary
		console.log(`\n📊 Shop Summary:`);
		console.log(`   Products:     ${result.productsProcessed}`);
		console.log(`   Media found:  ${result.mediaFound}`);
		console.log(`   Created:      ${result.created}`);
		console.log(`   Updated:      ${result.updated}`);
		console.log(`   Soft-deleted: ${result.softDeleted}`);
		console.log(`   Backed up:    ${result.backedUp}`);
		if (result.errors.length > 0) {
			console.log(`   Errors:       ${result.errors.length}`);
			result.errors.slice(0, 5).forEach((e) => console.log(`     - ${e}`));
			if (result.errors.length > 5) {
				console.log(`     ... and ${result.errors.length - 5} more`);
			}
		}
	}

	// Print overall summary
	console.log('\n' + '='.repeat(60));
	console.log('📊 OVERALL SUMMARY');
	console.log('='.repeat(60));

	const totals = results.reduce(
		(acc, r) => ({
			productsProcessed: acc.productsProcessed + r.productsProcessed,
			mediaFound: acc.mediaFound + r.mediaFound,
			created: acc.created + r.created,
			updated: acc.updated + r.updated,
			softDeleted: acc.softDeleted + r.softDeleted,
			backedUp: acc.backedUp + r.backedUp,
			errors: acc.errors + r.errors.length,
		}),
		{
			productsProcessed: 0,
			mediaFound: 0,
			created: 0,
			updated: 0,
			softDeleted: 0,
			backedUp: 0,
			errors: 0,
		},
	);

	console.log(`Shops processed: ${results.length}`);
	console.log(`Products:        ${totals.productsProcessed}`);
	console.log(`Media found:     ${totals.mediaFound}`);
	console.log(`Created:         ${totals.created}`);
	console.log(`Updated:         ${totals.updated}`);
	console.log(`Soft-deleted:    ${totals.softDeleted}`);
	console.log(`Backed up:       ${totals.backedUp}`);
	console.log(`Errors:          ${totals.errors}`);
	console.log('='.repeat(60));

	if (options.dryRun) {
		console.log('\n⚠️  This was a DRY RUN - no changes were made');
	}

	console.log('\n✅ Sync complete');
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('\n❌ Fatal error:', error);
		process.exit(1);
	});
