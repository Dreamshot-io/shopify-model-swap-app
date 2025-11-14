import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Text, Card, Button, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shopCredential } = await authenticate.admin(request);

  // Auto-connect web pixel if not connected
  try {
    const appUrl = shopCredential.appUrl;

    console.log("[app._index] Attempting to auto-connect web pixel...");

    // Try to create pixel (will fail if already exists, which is fine)
    const response = await admin.graphql(
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
              debug: "true", // Enable debug for development
            },
          },
        },
      },
    );

    const result = await response.json();

    if (result.data?.webPixelCreate?.userErrors?.length > 0) {
      const error = result.data.webPixelCreate.userErrors[0];
      if (error.code === "PIXEL_ALREADY_EXISTS" || error.message.includes("already exists")) {
        console.log("[app._index] Pixel already exists - should be connected");
      } else {
        console.warn("[app._index] Pixel creation error:", error.message, error.code);
      }
    } else if (result.data?.webPixelCreate?.webPixel?.id) {
      console.log("[app._index] ✅ Pixel created successfully:", result.data.webPixelCreate.webPixel.id);
    } else {
      console.warn("[app._index] Unexpected response from webPixelCreate:", result);
    }
  } catch (error) {
    // Log error but don't break the app load
    console.error("[app._index] Failed to auto-connect pixel:", error instanceof Error ? error.message : error);
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
