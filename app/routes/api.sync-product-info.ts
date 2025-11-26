/**
 * Product info sync API route
 * Called by Vercel Cron to sync all product media from Shopify to ProductInfo table
 * Runs daily at 2am UTC (after statistics export at midnight)
 */

import type { LoaderFunctionArgs } from '@remix-run/node';
import { PrismaClient } from '@prisma/client';
import { uploadImageFromUrlToR2 } from '~/services/storage.server';

// Allow function to run for up to 5 minutes (300 seconds)
export const maxDuration = 300;

// Use raw Prisma client to avoid extension type issues
const prisma = new PrismaClient();

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

interface ProductInfoRecord {
	id: string;
	shopId: string;
	productId: string;
	mediaId: string | null;
	shopifyUrl: string | null;
	r2Url: string | null;
	r2Key: string | null;
	backedUpAt: Date | null;
	deletedAt: Date | null;
}

/**
 * Validate request is from Vercel Cron
 */
function validateCronRequest(request: Request): boolean {
	const authHeader = request.headers.get('authorization');
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret) {
		console.warn('[sync-product-info] CRON_SECRET not configured');
		return false;
	}

	return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Get Shopify admin GraphQL client for a shop
 * Uses direct fetch to handle custom domains correctly
 */
async function getShopifyGraphQL(shopDomain: string) {
	const credential = await prisma.shopCredential.findFirst({
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

		return {
			json: async () => response.json(),
		};
	};

	return { graphql, credential };
}

/**
 * Fetch all products with media from Shopify
 */
async function fetchAllProducts(
	graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: () => Promise<unknown> }>,
): Promise<ShopifyProduct[]> {
	const products: ShopifyProduct[] = [];
	let hasNextPage = true;
	let cursor: string | null = null;

	while (hasNextPage) {
		const response = await graphql(
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

		products.push(...edges.map((edge) => edge.node));

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

/**
 * Sync products for a single shop
 */
async function syncShopProducts(shopId: string, shopDomain: string): Promise<SyncResult> {
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
		const { graphql } = await getShopifyGraphQL(shopDomain);
		const products = await fetchAllProducts(graphql);
		result.productsProcessed = products.length;

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

		// Get existing ProductInfo records
		const existingRecords = (await prisma.productInfo.findMany({
			where: {
				shopId,
				deletedAt: null,
			},
		})) as ProductInfoRecord[];

		const existingMediaIds = new Set(existingRecords.map((r) => r.mediaId).filter(Boolean) as string[]);

		// Process each media item
		for (const [mediaId, info] of mediaMap) {
			const existing = existingRecords.find((r) => r.mediaId === mediaId);

			if (existing) {
				// Update if URL changed or needs backup
				const needsUpdate = existing.shopifyUrl !== info.shopifyUrl;
				const needsBackup = !existing.r2Url;

				if (needsUpdate || needsBackup) {
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
			} else {
				// Create new record
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

		// Soft-delete records for media no longer in Shopify
		const mediaIdsToDelete = [...existingMediaIds].filter((id) => !shopifyMediaIds.has(id));
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

		return result;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		result.errors.push(`Shop sync failed: ${msg}`);
		return result;
	}
}

/**
 * GET /api/sync-product-info
 * Called by Vercel Cron daily at 2am UTC
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
	// Validate request is from Vercel Cron
	if (!validateCronRequest(request)) {
		console.log('[sync-product-info] Unauthorized request rejected');
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	console.log('[sync-product-info] Cron triggered');

	try {
		// Get all active shops
		const shops = await prisma.shopCredential.findMany({
			where: { status: 'ACTIVE' },
			select: { id: true, shopDomain: true },
		});

		console.log(`[sync-product-info] Found ${shops.length} active shops`);

		const results: SyncResult[] = [];

		for (const shop of shops) {
			console.log(`[sync-product-info] Syncing shop: ${shop.shopDomain}`);
			const result = await syncShopProducts(shop.id, shop.shopDomain);
			results.push(result);

			console.log(
				`[sync-product-info] Shop ${shop.shopDomain}: ${result.productsProcessed} products, ` +
					`${result.mediaFound} media, ${result.created} created, ${result.updated} updated, ` +
					`${result.backedUp} backed up, ${result.errors.length} errors`,
			);
		}

		// Calculate totals
		const totals = results.reduce(
			(acc, r) => ({
				shopsProcessed: acc.shopsProcessed + 1,
				productsProcessed: acc.productsProcessed + r.productsProcessed,
				mediaFound: acc.mediaFound + r.mediaFound,
				created: acc.created + r.created,
				updated: acc.updated + r.updated,
				softDeleted: acc.softDeleted + r.softDeleted,
				backedUp: acc.backedUp + r.backedUp,
				errors: acc.errors + r.errors.length,
			}),
			{
				shopsProcessed: 0,
				productsProcessed: 0,
				mediaFound: 0,
				created: 0,
				updated: 0,
				softDeleted: 0,
				backedUp: 0,
				errors: 0,
			},
		);

		console.log(`[sync-product-info] Sync completed:`, totals);

		return Response.json({
			success: true,
			totals,
			results,
		});
	} catch (error) {
		console.error('[sync-product-info] Sync failed:', error);
		return Response.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 },
		);
	} finally {
		await prisma.$disconnect();
	}
};
