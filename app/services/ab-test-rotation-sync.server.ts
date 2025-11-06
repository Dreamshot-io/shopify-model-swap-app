/**
 * Shopify media synchronization helpers invoked by the rotation engine to publish control/test
 * galleries using Admin GraphQL mutations.
 */
import type { RotationMediaItem } from './ab-test-rotation.store';
import type { RotationSwapParams, RotationSwapResult } from './ab-test-rotation.server';
import { RotationVariant } from '@prisma/client';
import shopify, { sessionStorage } from '../shopify.server';
import { updateRotationSlot } from './ab-test-rotation.store';

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation RotateProductImages($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        images(first: 100) {
          nodes {
            id
            url
            altText
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_MEDIA_QUERY = `#graphql
  query ProductMedia($id: ID!) {
    product(id: $id) {
      id
      images(first: 100) {
        nodes {
          id
          url
          altText
        }
      }
    }
  }
`;

export async function executeRotationSwap(params: RotationSwapParams): Promise<RotationSwapResult> {
  try {
    const client = await getAdminClient(params.slot.shop);
    const targetMedia = params.targetVariant === RotationVariant.CONTROL
      ? (params.slot.controlMedia as RotationMediaItem[])
      : (params.slot.testMedia as RotationMediaItem[]);

    if (!targetMedia || targetMedia.length === 0) {
      return {
        outcome: 'failure',
        message: 'No media defined for target variant',
      };
    }

    const imageInput = targetMedia.map(buildImageInput);
    const response = await client.query({
      data: {
        query: PRODUCT_UPDATE_MUTATION,
        variables: {
          input: {
            id: params.slot.productId,
            images: imageInput,
          },
        },
      },
    });

    const body = response.body as {
      data?: {
        productUpdate?: {
          product?: {
            images?: {
              nodes: Array<{
                id: string;
                url: string;
                altText?: string | null;
              }>;
            };
          };
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      };
    };

    const userErrors = body.data?.productUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      const message = userErrors.map(error => error.message).join('; ');
      return {
        outcome: 'failure',
        message,
      };
    }

    const nodes = body.data?.productUpdate?.product?.images?.nodes ?? [];
    if (nodes.length === 0) {
      return {
        outcome: 'failure',
        message: 'Product update succeeded but returned no images',
      };
    }

    const refreshedMedia = nodes.map((node, index) => {
      const template = targetMedia[index] ?? targetMedia[targetMedia.length - 1];
      return {
        id: node.id,
        url: node.url ?? template.url,
        position: index + 1,
        altText: node.altText ?? template.altText ?? null,
        metafieldId: template.metafieldId ?? null,
        variantIds: template.variantIds ?? undefined,
      } satisfies RotationMediaItem;
    });

    await updateRotationSlot(params.slot.id, {
      ...(params.targetVariant === RotationVariant.CONTROL
        ? { controlMedia: refreshedMedia }
        : { testMedia: refreshedMedia }),
    });

    return {
      outcome: 'success',
      context: {
        productId: params.slot.productId,
        publishedVariant: params.targetVariant,
        imageCount: refreshedMedia.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    return {
      outcome: 'failure',
      message,
    };
  }
}

async function getAdminClient(shop: string) {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const session = sessions.find(s => !s.isOnline) ?? sessions[0];

  if (!session) {
    throw new Error(`No stored session for shop ${shop}`);
  }

  return new shopify.api.clients.Graphql({ session });
}

function buildImageInput(item: RotationMediaItem) {
  const input: Record<string, unknown> = {
    altText: item.altText ?? undefined,
  };

  if (item.id) {
    input.id = item.id;
  } else {
    input.src = item.url;
  }

  // NOTE: Shopify's productUpdate mutation does NOT support variantIds in ProductImageInput
  // Variant associations are managed separately via productVariantAppendMedia.
  // When using existing media IDs, Shopify SHOULD preserve existing variant associations,
  // but this needs verification. See docs/shopify-variant-association-verification.md
  // If variantIds are provided, they're stored for reference but not sent to Shopify API
  // TODO: Add reconciliation step if associations are lost after productUpdate

  return input;
}

export async function snapshotProductMedia(shop: string, productId: string): Promise<RotationMediaItem[]> {
  const client = await getAdminClient(shop);
  const response = await client.query({
    data: {
      query: PRODUCT_MEDIA_QUERY,
      variables: { id: productId },
    },
  });

  const body = response.body as {
    data?: {
      product?: {
        images?: {
          nodes: Array<{
            id: string;
            url: string;
            altText?: string | null;
          }>;
        };
      };
    };
  };

  const nodes = body.data?.product?.images?.nodes ?? [];
  return nodes.map((node, index) => ({
    id: node.id,
    url: node.url,
    position: index + 1,
    altText: node.altText ?? null,
  } satisfies RotationMediaItem));
}
