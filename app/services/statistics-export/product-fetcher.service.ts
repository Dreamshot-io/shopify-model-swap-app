/**
 * Product fetcher service for statistics exports
 * Fetches product, variant, and image data from Shopify GraphQL API
 */

import type { AdminApiContext } from '@shopify/shopify-app-remix/server';

/**
 * Product data structure from Shopify
 */
export interface ShopifyProduct {
	id: string; // GID format
	title: string;
	status: string;
}

/**
 * Variant data structure from Shopify
 */
export interface ShopifyVariant {
	id: string; // GID format
	title: string;
	displayName: string;
}

/**
 * Image data structure from Shopify
 */
export interface ShopifyImage {
	mediaId: string; // GID format
	url: string;
	altText: string | null;
}

/**
 * GraphQL admin type (for testing)
 */
type GraphQLFunction = AdminApiContext['graphql'];

/**
 * Fetch all products for a shop
 * Returns array of products with basic information
 */
export async function getAllShopProducts(
	admin: GraphQLFunction,
): Promise<ShopifyProduct[]> {
	const response = await admin(
		`#graphql
      query GetProducts($first: Int!) {
        products(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              status
            }
          }
        }
      }`,
		{
			variables: { first: 250 }, // Fetch up to 250 products
		},
	);

	const data = await response.json();
	const edges = data.data?.products?.edges || [];

	return edges.map((edge: { node: ShopifyProduct }) => edge.node);
}

/**
 * Fetch all variants for a specific product
 */
export async function getProductVariants(
	admin: GraphQLFunction,
	productId: string,
): Promise<ShopifyVariant[]> {
	const response = await admin(
		`#graphql
      query GetProductVariants($productId: ID!) {
        product(id: $productId) {
          id
          title
          variants(first: 100) {
            nodes {
              id
              title
              displayName
            }
          }
        }
      }`,
		{
			variables: { productId },
		},
	);

	const data = await response.json();
	const product = data.data?.product;

	if (!product) {
		return [];
	}

	return product.variants.nodes || [];
}

/**
 * Fetch all images (media) for a specific product
 */
export async function getProductImages(
	admin: GraphQLFunction,
	productId: string,
): Promise<ShopifyImage[]> {
	const response = await admin(
		`#graphql
      query GetProductMedia($productId: ID!) {
        product(id: $productId) {
          id
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
      }`,
		{
			variables: { productId },
		},
	);

	const data = await response.json();
	const product = data.data?.product;

	if (!product) {
		return [];
	}

	const mediaNodes = product.media.nodes || [];

	// Filter and map to only include images (not videos, etc.)
	return mediaNodes
		.filter((node: { image?: unknown }) => node.image !== undefined)
		.map((node: { id: string; image: { url: string; altText: string | null } }) => ({
			mediaId: node.id,
			url: node.image.url,
			altText: node.image.altText,
		}));
}
