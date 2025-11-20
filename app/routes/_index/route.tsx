import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  InlineStack,
  List,
} from "@shopify/polaris";
import { useState } from "react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslations from "@shopify/polaris/locales/en.json";

import { login } from "../../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const [shop, setShop] = useState("");

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Layout>
          <Layout.Section>
            <BlockStack gap="800">
              <BlockStack gap="400" inlineAlign="center">
                <Text variant="heading2xl" as="h1" alignment="center">
                  Dreamshot A/B Test
                </Text>
                <Text variant="bodyLg" as="p" alignment="center" tone="subdued">
                  Transform your product images with AI-powered editing and A/B testing to boost conversions
                </Text>
              </BlockStack>

              {showForm && (
                <Layout>
                  <Layout.Section variant="oneThird">
                    <div />
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" as="h2">
                          Install Dreamshot
                        </Text>
                        <Form method="post" action="/auth/login">
                          <BlockStack gap="400">
                            <TextField
                              label="Shop domain"
                              type="text"
                              name="shop"
                              value={shop}
                              onChange={setShop}
                              placeholder="my-shop-domain.myshopify.com"
                              autoComplete="off"
                            />
                            <Button submit variant="primary" size="large" fullWidth>
                              Install App
                            </Button>
                          </BlockStack>
                        </Form>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <div />
                  </Layout.Section>
                </Layout>
              )}

              <Layout>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h2">
                          🧪 A/B Testing
                        </Text>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        Test different product images to discover which visuals perform best with your customers
                      </Text>
                      <List>
                        <List.Item>Automated split testing for product images</List.Item>
                        <List.Item>Real-time performance analytics</List.Item>
                        <List.Item>Data-driven insights for optimization</List.Item>
                      </List>
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h2">
                          🎨 AI Image Generation
                        </Text>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        Generate and edit stunning product images using advanced AI technology
                      </Text>
                      <List>
                        <List.Item>Professional image enhancement</List.Item>
                        <List.Item>Background replacement and editing</List.Item>
                        <List.Item>Create multiple variants instantly</List.Item>
                      </List>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </PolarisAppProvider>
  );
}
