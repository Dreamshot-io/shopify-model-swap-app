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
        query GetProductVariants($productId: ID!) {
          product(id: $productId) {
            id
            title
            variants(first: 100) {
              nodes {
                id
                displayName
                title
                image {
                  url
                  altText
                }
              }
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

    return json({
      variants: product.variants.nodes,
    });
  } catch (error) {
    console.error('Failed to fetch product variants:', error);
    return json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
};