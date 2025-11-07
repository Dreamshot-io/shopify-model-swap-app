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
        query GetProductImages($productId: ID!) {
          product(id: $productId) {
            id
            title
            images(first: 100) {
              nodes {
                id
                url
                altText
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
      id: product.id,
      title: product.title,
      images: product.images.nodes,
    });
  } catch (error) {
    console.error('Failed to fetch product:', error);
    return json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
};