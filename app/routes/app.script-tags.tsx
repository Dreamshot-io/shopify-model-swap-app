import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Button, Card, Page, Text, Banner } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check if script tag exists
  const response = await admin.graphql(`
    query {
      scriptTags(first: 10) {
        edges {
          node {
            id
            src
            displayScope
          }
        }
      }
    }
  `);

  const data = await response.json();
  const scriptTags = data.data?.scriptTags?.edges || [];
  const hasTrackingScript = scriptTags.some((edge: any) =>
    edge.node.src?.includes('api/tracking-script')
  );

  return json({ hasTrackingScript, scriptTags });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  const appUrl = process.env.SHOPIFY_APP_URL || "https://shopify.dreamshot.io";
  const scriptUrl = `${appUrl}/api/tracking-script.js`;

  if (action === "install") {
    // Create script tag
    const response = await admin.graphql(`
      mutation scriptTagCreate($input: ScriptTagInput!) {
        scriptTagCreate(input: $input) {
          scriptTag {
            id
            src
            displayScope
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        input: {
          src: scriptUrl,
          displayScope: "ONLINE_STORE"
        }
      }
    });

    const result = await response.json();

    if (result.data?.scriptTagCreate?.userErrors?.length > 0) {
      return json({
        success: false,
        error: result.data.scriptTagCreate.userErrors[0].message
      });
    }

    return json({ success: true, message: "Tracking script installed!" });
  }

  if (action === "remove") {
    // Remove all tracking script tags
    const response = await admin.graphql(`
      query {
        scriptTags(first: 10) {
          edges {
            node {
              id
              src
            }
          }
        }
      }
    `);

    const data = await response.json();
    const scriptTags = data.data?.scriptTags?.edges || [];

    for (const edge of scriptTags) {
      if (edge.node.src?.includes('api/tracking-script')) {
        await admin.graphql(`
          mutation scriptTagDelete($id: ID!) {
            scriptTagDelete(id: $id) {
              deletedScriptTagId
            }
          }
        `, {
          variables: { id: edge.node.id }
        });
      }
    }

    return json({ success: true, message: "Tracking script removed!" });
  }

  return json({ success: false, error: "Invalid action" });
};

export default function ScriptTags() {
  const { hasTrackingScript } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  return (
    <Page
      title="Alternative Event Tracking"
      subtitle="Install tracking script directly to storefront"
    >
      <Card>
        <Text as="h2" variant="headingMd">Script Tag Installation</Text>
        <Text as="p">
          Since the web pixel won't connect, we'll use Script Tags API instead.
          This will inject tracking code directly into your storefront.
        </Text>

        <div style={{ marginTop: "20px" }}>
          {actionData?.success && (
            <Banner status="success">
              {actionData.message}
            </Banner>
          )}

          {actionData?.error && (
            <Banner status="critical">
              {actionData.error}
            </Banner>
          )}

          {hasTrackingScript ? (
            <>
              <Banner status="info">
                Tracking script is currently installed
              </Banner>
              <Form method="post">
                <input type="hidden" name="action" value="remove" />
                <Button submit variant="secondary" loading={isLoading}>
                  Remove Tracking Script
                </Button>
              </Form>
            </>
          ) : (
            <Form method="post">
              <input type="hidden" name="action" value="install" />
              <Button submit variant="primary" loading={isLoading}>
                Install Tracking Script
              </Button>
            </Form>
          )}
        </div>

        <div style={{ marginTop: "20px" }}>
          <Text as="h3" variant="headingSm">What this does:</Text>
          <ul>
            <li>Tracks product views (impressions)</li>
            <li>Tracks add to cart events</li>
            <li>Tracks purchases</li>
            <li>Works with A/B test rotation</li>
          </ul>
        </div>
      </Card>
    </Page>
  );
}
