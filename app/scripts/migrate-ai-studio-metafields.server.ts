/**
 * Migration script to move AI Studio library data from metafields to database
 * Run this script to migrate all existing AI Studio library data
 */

import { AIStudioMediaService } from "../services/ai-studio-media.server";
import prisma from "../db.server";
import { getShopifyContextByShopDomain } from "../shopify.server";

interface GraphQLResponse {
	data?: {
		products?: {
			edges?: Array<{
				node?: {
					id: string;
					title: string;
					metafield?: {
						id?: string;
						value?: string;
					};
				};
			}>;
			pageInfo?: {
				hasNextPage?: boolean;
				endCursor?: string | null;
			};
		};
	};
}

interface AdminClient {
	request: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ data: GraphQLResponse['data'] }>;
}

async function createAdminClient(shop: string, accessToken: string): Promise<AdminClient> {
	const { app } = await getShopifyContextByShopDomain(shop);
	const { admin } = await app.unauthenticated.admin(shop);

	return {
		request: async (query: string, options?: { variables?: Record<string, unknown> }) => {
			const response = await admin.graphql(query, options);
			const json = (await response.json()) as GraphQLResponse;
			return { data: json.data || json };
		},
	};
}

interface MigrationStats {
  shop: string;
  productsProcessed: number;
  imagesProcessed: number;
  imagesMigrated: number;
  errors: Array<{ productId: string; error: string }>;
}

async function migrateShop(shop: string): Promise<MigrationStats> {
  const stats: MigrationStats = {
    shop,
    productsProcessed: 0,
    imagesProcessed: 0,
    imagesMigrated: 0,
    errors: [],
  };

  try {
    // Get session for this shop
    const session = await prisma.session.findFirst({
      where: { shop },
    });

    if (!session) {
      console.error(`No session found for shop: ${shop}`);
      return stats;
    }

    // Create admin context
    const admin = await createAdminClient(shop, session.accessToken);

    console.log(`[Migration] Starting migration for shop: ${shop}`);

    // Fetch all products with AI library metafields
    const productsQuery = `#graphql
      query GetProductsWithLibrary($cursor: String) {
        products(first: 50, after: $cursor) {
          edges {
            node {
              id
              title
              metafield(namespace: "dreamshot", key: "ai_library") {
                value
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const response = await admin.request(productsQuery, {
        variables: { cursor },
      });

			const data = response.data;
			const products = data?.products?.edges || [];

      for (const edge of products) {
        const product = edge.node;
        stats.productsProcessed++;

        if (!product.metafield?.value) {
          continue;
        }

        console.log(`[Migration] Processing product: ${product.title} (${product.id})`);

        try {
          // Parse metafield data
          const metafieldData = JSON.parse(product.metafield.value);

          if (!Array.isArray(metafieldData) || metafieldData.length === 0) {
            continue;
          }

          stats.imagesProcessed += metafieldData.length;

			// Create AIStudioMediaService instance
			const aiStudioMediaService = new AIStudioMediaService(
				{ graphql: admin.request.bind(admin) } as { graphql: AdminClient['request'] },
				prisma,
			);

          // Migrate each image
          const migrated = await aiStudioMediaService.migrateFromMetafield(
            shop,
            product.id,
            product.metafield.value
          );

          stats.imagesMigrated += migrated;
          console.log(`[Migration] Migrated ${migrated} images for product ${product.title}`);

        } catch (error) {
          console.error(`[Migration] Error processing product ${product.id}:`, error);
          stats.errors.push({
            productId: product.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      hasNextPage = data?.products?.pageInfo?.hasNextPage || false;
      cursor = data?.products?.pageInfo?.endCursor;
    }

    console.log(`[Migration] ✓ Completed migration for shop: ${shop}`);
    console.log(`[Migration] Stats:`, stats);

  } catch (error) {
    console.error(`[Migration] Fatal error for shop ${shop}:`, error);
    stats.errors.push({
      productId: "N/A",
      error: `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return stats;
}

async function cleanupMetafields(shop: string, dryRun = true): Promise<void> {
  /**
   * Optional cleanup function to remove metafields after successful migration
   * Set dryRun=false to actually delete metafields
   */

  const session = await prisma.session.findFirst({
    where: { shop },
  });

  if (!session) {
    console.error(`No session found for shop: ${shop}`);
    return;
  }

  const admin = await createAdminClient(shop, session.accessToken);

  const query = `#graphql
    query GetProductsWithLibrary($cursor: String) {
      products(first: 50, after: $cursor) {
        edges {
          node {
            id
            title
            metafield(namespace: "dreamshot", key: "ai_library") {
              id
              value
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const deleteMutation = `#graphql
    mutation DeleteMetafield($id: ID!) {
      metafieldDelete(input: { id: $id }) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor = null;
  let deletedCount = 0;

  while (hasNextPage) {
    const response = await admin.request(query, {
      variables: { cursor },
    });

		const data = response.data;
		const products = data?.products?.edges || [];

    for (const edge of products) {
      const product = edge.node;

      if (!product.metafield?.id) {
        continue;
      }

      if (dryRun) {
        console.log(`[Cleanup] Would delete metafield for product: ${product.title}`);
      } else {
        try {
          await admin.request(deleteMutation, {
            variables: { id: product.metafield.id },
          });
          deletedCount++;
          console.log(`[Cleanup] Deleted metafield for product: ${product.title}`);
        } catch (error) {
          console.error(`[Cleanup] Error deleting metafield for ${product.title}:`, error);
        }
      }
    }

    hasNextPage = data?.products?.pageInfo?.hasNextPage || false;
    cursor = data?.products?.pageInfo?.endCursor;
  }

  console.log(`[Cleanup] ${dryRun ? "Would delete" : "Deleted"} ${deletedCount} metafields`);
}

// Main execution
export async function runMigration(shops?: string[], cleanupAfter = false): Promise<MigrationStats[]> {
  const allStats: MigrationStats[] = [];

  try {
    // If no shops specified, migrate all shops
    if (!shops || shops.length === 0) {
      const sessions = await prisma.session.findMany({
        select: { shop: true },
        distinct: ["shop"],
      });
      shops = sessions.map((s) => s.shop);
    }

    console.log(`[Migration] Starting migration for ${shops.length} shops`);

    for (const shop of shops) {
      const stats = await migrateShop(shop);
      allStats.push(stats);

      // Only cleanup if migration was successful
      if (cleanupAfter && stats.errors.length === 0 && stats.imagesMigrated > 0) {
        console.log(`[Migration] Running cleanup for shop: ${shop}`);
        await cleanupMetafields(shop, false);
      }
    }

    // Print summary
    console.log("\n[Migration] ===== MIGRATION SUMMARY =====");
    for (const stats of allStats) {
      console.log(`Shop: ${stats.shop}`);
      console.log(`  Products processed: ${stats.productsProcessed}`);
      console.log(`  Images processed: ${stats.imagesProcessed}`);
      console.log(`  Images migrated: ${stats.imagesMigrated}`);
      if (stats.errors.length > 0) {
        console.log(`  Errors: ${stats.errors.length}`);
        stats.errors.forEach((e) => console.log(`    - ${e.productId}: ${e.error}`));
      }
    }

  } catch (error) {
    console.error("[Migration] Fatal error:", error);
  } finally {
    await prisma.$disconnect();
  }

  return allStats;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const cleanupFlag = args.includes("--cleanup");
  const dryRunFlag = args.includes("--dry-run");
  const shops = args.filter((arg) => !arg.startsWith("--"));

  if (dryRunFlag) {
    console.log("[Migration] DRY RUN MODE - No actual changes will be made");
  }

  console.log("[Migration] Starting AI Studio metafield migration...");
  console.log(`[Migration] Shops to migrate: ${shops.length > 0 ? shops.join(", ") : "ALL"}`);
  console.log(`[Migration] Cleanup after migration: ${cleanupFlag}`);

  runMigration(shops.length > 0 ? shops : undefined, cleanupFlag && !dryRunFlag)
    .then(() => {
      console.log("[Migration] Migration completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[Migration] Migration failed:", error);
      process.exit(1);
    });
}
