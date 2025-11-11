import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Text, Card, Button, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Auto-connect web pixel if not connected
  try {
    const appUrl =
      process.env.SHOPIFY_APP_URL || "https://shopify.dreamshot.io";

    // Try to create pixel (will fail if already exists, which is fine)
    await admin
      .graphql(
        `
      mutation webPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { field message code }
          webPixel { id settings }
        }
      }
    `,
        {
          variables: {
            webPixel: {
              settings: {
                app_url: appUrl,
                enabled: "true",
                debug: "false",
              },
            },
          },
        },
      )
      .catch((err) => {
        // Ignore errors - pixel might already exist
        console.log("Web pixel auto-connect attempted");
      });
  } catch (error) {
    // Silent fail - don't break the app load
  }

  return json({});
};

export default function Index() {
  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">
        <BlockStack gap="300">
          <Text variant="headingLg" as="h1">
            Welcome to Dreamshot A/B Test Configurator
          </Text>
          <Text tone="subdued" as="p">
            Transform your product images with AI-powered editing and A/B
            testing to boost conversions.
          </Text>
        </BlockStack>

        <div
          style={{
            display: "flex",
            gap: "16px",
            width: "100%",
          }}
        >
          <div
            style={{
              flex: "1 1 50%",
              width: "50%",
            }}
          >
            <Card>
              <BlockStack gap="500" align="center" inlineAlign="center">
                <div
                  style={{
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    backgroundColor: "#F1F2F4",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "40px",
                    margin: "0 auto",
                  }}
                >
                  🧪
                </div>
                <BlockStack gap="300" align="center" inlineAlign="center">
                  <Text variant="headingMd" as="h2" alignment="center">
                    Manage A/B Tests
                  </Text>
                  <Text tone="subdued" as="p" alignment="center">
                    Test different product images to optimize conversions and
                    discover which visuals perform best with your customers.
                  </Text>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <Button url="/app/ab-tests" variant="primary" size="large">
                      Manage A/B Tests
                    </Button>
                  </div>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>

          <div
            style={{
              flex: "1 1 50%",
              width: "50%",
            }}
          >
            <Card>
              <BlockStack gap="500" align="center" inlineAlign="center">
                <div
                  style={{
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    backgroundColor: "#F1F2F4",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "40px",
                    margin: "0 auto",
                  }}
                >
                  🎨
                </div>
                <BlockStack gap="300" align="center" inlineAlign="center">
                  <Text variant="headingMd" as="h2" alignment="center">
                    Create AI Images
                  </Text>
                  <Text tone="subdued" as="p" alignment="center">
                    Generate and edit product images using AI. Create stunning
                    visuals that showcase your products in new ways.
                  </Text>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <Button url="/app/ai-studio" variant="primary" size="large">
                      Create AI Images
                    </Button>
                  </div>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}
