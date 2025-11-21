import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopCredential } = await authenticate.admin(request);

  // TODO: Re-enable billing once config format is fixed for SDK 3.8+
  // if (!process.env.DISABLE_BILLING) {
  //   await billing.require({
  //     plans: [MONTHLY_PLAN],
  //     isTest: process.env.NODE_ENV !== "production",
  //     onFailure: async () =>
  //       billing.request({
  //         plan: MONTHLY_PLAN],
  //         isTest: process.env.NODE_ENV !== "production",
  //       }),
  //   });
  // }

  return { apiKey: shopCredential.apiKey, appUrl: shopCredential.appUrl };
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
          Home
        </Link>
        <Link to="/app/ab-tests">🧪 A/B Tests</Link>
        <Link to="/app/ai-studio">🎨 AI Studio</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
