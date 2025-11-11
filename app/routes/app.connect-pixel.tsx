import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Button, Card, Page, Text, Banner } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check if web pixel exists
  try {
    const response = await admin.graphql(`
      query {
        webPixel {
          id
          settings
        }
      }
    `);

    const data = await response.json();
    const hasPixel = !!data.data?.webPixel?.id;

    return json({
      hasPixel,
      pixelId: data.data?.webPixel?.id,
      settings: data.data?.webPixel?.settings
    });
  } catch (error) {
    // If query fails, pixel probably doesn't exist
    return json({ hasPixel: false, pixelId: null, settings: null });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  const appUrl = process.env.SHOPIFY_APP_URL || "https://shopify.dreamshot.io";

  if (action === "connect") {
    try {
      // Try to create the web pixel
      const response = await admin.graphql(`
        mutation webPixelCreate($webPixel: WebPixelInput!) {
          webPixelCreate(webPixel: $webPixel) {
            userErrors {
              field
              message
              code
            }
            webPixel {
              id
              settings
            }
          }
        }
      `, {
        variables: {
          webPixel: {
            settings: {
              app_url: appUrl,
              enabled: "true",
              debug: "true"
            }
          }
        }
      });

      const result = await response.json();

      if (result.data?.webPixelCreate?.userErrors?.length > 0) {
        const error = result.data.webPixelCreate.userErrors[0];

        // Check if pixel already exists
        if (error.code === "PIXEL_ALREADY_EXISTS" || error.message.includes("already exists")) {
          return json({
            success: false,
            error: "Pixel already exists. It should be connected now.",
            alreadyExists: true
          });
        }

        return json({
          success: false,
          error: error.message,
          code: error.code
        });
      }

      if (result.data?.webPixelCreate?.webPixel?.id) {
        return json({
          success: true,
          pixelId: result.data.webPixelCreate.webPixel.id,
          message: "Web pixel connected successfully!"
        });
      }

      return json({
        success: false,
        error: "Failed to create pixel - no ID returned"
      });
    } catch (error) {
      console.error("Failed to connect pixel:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }

  if (action === "update") {
    // Get pixel ID from form
    const pixelId = formData.get("pixelId");

    if (!pixelId) {
      return json({
        success: false,
        error: "No pixel ID found. Create pixel first."
      });
    }

    try {
      const response = await admin.graphql(`
        mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
          webPixelUpdate(id: $id, webPixel: $webPixel) {
            userErrors {
              field
              message
            }
            webPixel {
              id
              settings
            }
          }
        }
      `, {
        variables: {
          id: pixelId,
          webPixel: {
            settings: {
              app_url: appUrl,
              enabled: "true",
              debug: "false"  // Turn off debug in update
            }
          }
        }
      });

      const result = await response.json();

      if (result.data?.webPixelUpdate?.userErrors?.length > 0) {
        return json({
          success: false,
          error: result.data.webPixelUpdate.userErrors[0].message
        });
      }

      return json({
        success: true,
        message: "Web pixel settings updated!"
      });
    } catch (error) {
      console.error("Failed to update pixel:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }

  return json({ success: false, error: "Invalid action" });
};

export default function ConnectPixel() {
  const { hasPixel, pixelId, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  return (
    <Page
      title="Connect Web Pixel"
      subtitle="Programmatically connect the AB Test tracking pixel"
    >
      <Card>
        <Text as="h2" variant="headingMd">Web Pixel Connection</Text>
        <Text as="p">
          This uses the GraphQL webPixelCreate mutation to connect your pixel programmatically,
          bypassing the broken Shopify Admin UI.
        </Text>

        <div style={{ marginTop: "20px" }}>
          {hasPixel ? (
            <Banner status="success" title="Pixel Exists">
              <Text>Pixel ID: {pixelId}</Text>
              {settings && <Text>Settings: {settings}</Text>}
            </Banner>
          ) : (
            <Banner status="info">
              No pixel found. Click "Connect Pixel" to create one.
            </Banner>
          )}

          {actionData?.success && (
            <Banner status="success" title="Success!">
              {actionData.message}
              {actionData.pixelId && <Text>Pixel ID: {actionData.pixelId}</Text>}
            </Banner>
          )}

          {actionData?.error && (
            <Banner
              status={actionData.alreadyExists ? "warning" : "critical"}
              title={actionData.alreadyExists ? "Pixel Exists" : "Error"}
            >
              {actionData.error}
              {actionData.code && <Text>Code: {actionData.code}</Text>}
            </Banner>
          )}

          <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
            {!hasPixel ? (
              <Form method="post">
                <input type="hidden" name="action" value="connect" />
                <Button submit variant="primary" loading={isLoading}>
                  Connect Pixel
                </Button>
              </Form>
            ) : (
              <>
                <Form method="post">
                  <input type="hidden" name="action" value="update" />
                  <input type="hidden" name="pixelId" value={pixelId || ""} />
                  <Button submit variant="secondary" loading={isLoading}>
                    Update Settings
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="action" value="connect" />
                  <Button submit variant="primary" loading={isLoading}>
                    Try Reconnect
                  </Button>
                </Form>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: "30px" }}>
          <Text as="h3" variant="headingSm">How this works:</Text>
          <ul>
            <li>Uses webPixelCreate mutation to create pixel record</li>
            <li>Automatically activates the pixel extension</li>
            <li>Validates settings against shopify.extension.toml</li>
            <li>No manual UI interaction needed!</li>
          </ul>

          <Text as="h3" variant="headingSm" style={{ marginTop: "20px" }}>
            After connecting:
          </Text>
          <ul>
            <li>Check Customer Events in Shopify Admin</li>
            <li>Pixel should show as connected</li>
            <li>Events will start tracking immediately</li>
            <li>Monitor events with: bun run scripts/monitor-events.ts</li>
          </ul>
        </div>
      </Card>
    </Page>
  );
}
