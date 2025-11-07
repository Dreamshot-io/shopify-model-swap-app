import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Text, Card, Button, BlockStack, InlineStack } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [generated, draftsSaved, draftsDeleted, published, recent] =
    await Promise.all([
      db.metricEvent.count({
        where: { shop, eventType: "GENERATED", timestamp: { gte: since } },
      }),
      db.metricEvent.count({
        where: { shop, eventType: "DRAFT_SAVED", timestamp: { gte: since } },
      }),
      db.metricEvent.count({
        where: { shop, eventType: "DRAFT_DELETED", timestamp: { gte: since } },
      }),
      db.metricEvent.count({
        where: { shop, eventType: "PUBLISHED", timestamp: { gte: since } },
      }),
      db.metricEvent.findMany({
        where: { shop },
        orderBy: { timestamp: "desc" },
        take: 10,
        select: {
          id: true,
          eventType: true,
          imageUrl: true,
          productId: true,
          timestamp: true,
        },
      }),
    ]);

  // Fetch 5 most recent products
  const productsRes = await admin.graphql(
    `#graphql
      query DashboardRecentProducts($first: Int!) {
        products(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges { node { id title status createdAt handle } }
        }
      }
    `,
    { variables: { first: 5 } },
  );
  const productsJson = await productsRes.json();
  const recentProducts =
    productsJson?.data?.products?.edges?.map((e: any) => e.node) ?? [];

  return json({
    stats: { generated, draftsSaved, draftsDeleted, published },
    recent,
    recentProducts,
  });
};

export default function Index() {
  const { stats, recent, recentProducts } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (!stats) return;
  }, [stats, shopify]);

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Last 30 days
                </Text>
                <InlineStack gap="400">
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="headingLg">
                        {stats.generated}
                      </Text>
                      <Text as="p" tone="subdued">
                        Images generated
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="headingLg">
                        {stats.draftsSaved}
                      </Text>
                      <Text as="p" tone="subdued">
                        Drafts saved
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="headingLg">
                        {stats.published}
                      </Text>
                      <Text as="p" tone="subdued">
                        Published to products
                      </Text>
                    </BlockStack>
                  </Card>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Recent activity
                </Text>
                <BlockStack gap="200">
                  {recent.map((e: any) => (
                    <InlineStack key={e.id} align="space-between">
                      <Text as="span">{e.eventType}</Text>
                      <Text as="span" tone="subdued">
                        {new Date(e.timestamp).toLocaleString()}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Quick links
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/ai-studio" variant="primary">
                    Open AI Studio
                  </Button>
                  <Button url="shopify:admin/products" variant="secondary">
                    View all products
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Recent products
                </Text>
                <BlockStack gap="200">
                  {recentProducts.map((p: any) => {
                    const id = String(p.id).replace(
                      "gid://shopify/Product/",
                      "",
                    );
                    return (
                      <InlineStack key={p.id} align="space-between">
                        <Text as="span">{p.title}</Text>
                        <Button
                          url={`shopify:admin/products/${id}`}
                          variant="plain"
                        >
                          Open
                        </Button>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
