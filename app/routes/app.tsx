import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Page, Layout, Card, Text, BlockStack, Banner, Box } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate, createShopCookie } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopCredential, shopDomain } = await authenticate.admin(request);

  // Note: Billing is managed through Shopify Partner Dashboard pricing plans
  // The app_subscriptions/update webhook handles subscription changes
  // No programmatic billing checks needed here

  return json(
    { apiKey: shopCredential.apiKey, appUrl: shopCredential.appUrl },
    { headers: { "Set-Cookie": createShopCookie(shopDomain) } }
  );
};

export default function App() {
  const { apiKey, appUrl } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.ENV = ${JSON.stringify({
            SHOPIFY_APP_URL: appUrl,
          })};`,
        }}
      />
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  
  // Let Shopify handle OAuth-related errors (redirects, etc.)
  const shopifyBoundary = boundary.error(error);
  if (shopifyBoundary) {
    return shopifyBoundary;
  }

  // Extract error details for display
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the app.";
  let statusCode: number | undefined;

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 401) {
      title = "Authentication Error";
      message = "Unable to authenticate with Shopify. Please try reinstalling the app.";
    } else if (error.status === 404) {
      title = "Shop Not Found";
      message = "This shop is not registered with the app. Please contact support to set up your account.";
    } else if (error.status === 400) {
      title = "Invalid Request";
      message = error.data || "The request could not be processed. Please try again.";
    } else {
      message = error.data || error.statusText || message;
    }
  } else if (error instanceof Error) {
    if (error.message.includes("credential") || error.message.includes("apiKey")) {
      title = "Configuration Error";
      message = "There is a problem with the app credentials. Please contact support.";
    } else if (error.message.includes("session")) {
      title = "Session Expired";
      message = "Your session has expired. Please refresh the page to continue.";
    } else {
      message = error.message;
    }
  }

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Box paddingBlockStart="800">
            <Card>
              <BlockStack gap="400">
                <Banner title={title} tone="critical">
                  <p>{message}</p>
                </Banner>
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    If this problem persists, please contact support with the following details:
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {statusCode && `Status: ${statusCode} • `}
                    Time: {new Date().toISOString()}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
