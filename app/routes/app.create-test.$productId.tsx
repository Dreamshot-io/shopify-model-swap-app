import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData, useNavigate } from '@remix-run/react';
import { Page, Layout, Card } from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import { ABTestCreationForm } from '../features/ab-testing/components';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = params.productId;

  if (!productId) {
    return redirect('/app');
  }

  const decodedProductId = decodeURIComponent(productId);

  // Fetch product info for the form
  const response = await admin.graphql(
    `#graphql
    query GetProductBasic($id: ID!) {
      product(id: $id) {
        id
        title
      }
    }`,
    { variables: { id: decodedProductId } },
  );

  const responseJson = await response.json();
  const product = responseJson.data?.product;

  if (!product) {
    throw new Response('Product not found', { status: 404 });
  }

  return json({
    productId: decodedProductId,
    productTitle: product.title,
    shop: session.shop,
  });
};

// Note: ABTestCreationForm submits directly to /app/ab-tests with intent: "create"
// No action handler needed here

export default function CreateTestPage() {
  const { productId, productTitle, shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const handleSuccess = () => {
    shopify.toast.show('Test created successfully!');
    // Navigate back to product page, Tests tab
    navigate(`/app/products/${encodeURIComponent(productId)}?tab=tests`);
  };

  const handleCancel = () => {
    // Navigate back to product page
    navigate(`/app/products/${encodeURIComponent(productId)}`);
  };

  return (
    <Page
      title="Create A/B Test"
      subtitle={productTitle}
      fullWidth
      backAction={{
        content: 'Back',
        onAction: handleCancel,
      }}
    >
      <Layout>
        <Layout.Section>
          <ABTestCreationForm
            productId={productId}
            productTitle={productTitle}
            shop={shop}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
