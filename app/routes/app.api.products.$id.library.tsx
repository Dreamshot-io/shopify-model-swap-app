import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = params.id;

  if (!productId) {
    return json({ error: 'Product ID required' }, { status: 400 });
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query GetProductLibrary($productId: ID!) {
          product(id: $productId) {
            id
            title
            metafield(namespace: "dreamshot", key: "ai_library") {
              value
            }
          }
        }
      `,
      {
        variables: { productId: decodeURIComponent(productId) },
      }
    );

    const data = await response.json();
    const product = data.data?.product;

    if (!product) {
      return json({ error: 'Product not found' }, { status: 404 });
    }

    // Parse library items from metafield
    let libraryItems: Array<{ imageUrl: string; sourceUrl?: string | null }> = [];
    if (product.metafield?.value) {
      try {
        const parsed = JSON.parse(product.metafield.value);
        libraryItems = Array.isArray(parsed)
          ? parsed.map(item => {
              if (typeof item === 'string') {
                return { imageUrl: item };
              }
              return {
                imageUrl: item.imageUrl,
                sourceUrl: item.sourceUrl || null,
              };
            })
          : [];
      } catch (parseError) {
        console.error('Failed to parse library metafield:', parseError);
      }
    }

    return json({
      libraryItems,
    });
  } catch (error) {
    console.error('Failed to fetch product library:', error);
    return json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
};