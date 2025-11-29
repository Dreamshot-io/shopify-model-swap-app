import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  TextField,
  InlineGrid,
  EmptyState,
  Button,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db, { lookupShopId } from "../db.server";

interface Product {
  id: string;
  title: string;
  status: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
}

interface ActiveTest {
  id: string;
  name: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  status: string;
  currentCase: string;
  impressions: number;
  conversions: number;
  cvr: number;
  lift: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, shopCredential } = await authenticate.admin(request);

  // Auto-connect web pixel if not connected
  try {
    const appUrl = shopCredential.appUrl;
    console.log("[app._index] Attempting to auto-connect web pixel...");

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
              debug: "true",
            },
          },
        },
      },
    );

    const result = await response.json();
    if (result.data?.webPixelCreate?.userErrors?.length > 0) {
      const error = result.data.webPixelCreate.userErrors[0];
      if (error.code !== "PIXEL_ALREADY_EXISTS" && !error.message.includes("already exists")) {
        console.warn("[app._index] Pixel creation error:", error.message);
      }
    }
  } catch (error) {
    console.error("[app._index] Failed to auto-connect pixel:", error instanceof Error ? error.message : error);
  }

  // Fetch products
  const productsResponse = await admin.graphql(
    `#graphql
      query GetProducts {
        products(first: 50, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              status
              featuredImage {
                url
                altText
              }
            }
          }
        }
      }
    `,
  );

  const productsData = await productsResponse.json();
  const products: Product[] = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

  // Fetch shop data
  const shopId = await lookupShopId(session.shop);
  if (!shopId) {
    return json({ products, activeTests: [], productStats: {} });
  }

  // Fetch all tests to get stats per product
  const allTests = await db.aBTest.findMany({
    where: { shopId },
    include: {
      events: {
        take: 1000,
      },
    },
  });

  // Get active tests with stats
  const activeTests: ActiveTest[] = [];
  const productStats: Record<string, { imageCount: number; hasActiveTest: boolean; testCount: number }> = {};

  // Get library image counts per product
  const imageCountByProduct = await db.aIStudioImage.groupBy({
    by: ['productId'],
    where: { shopId, state: 'LIBRARY' },
    _count: { id: true },
  });

  const imageCounts: Record<string, number> = {};
  imageCountByProduct.forEach((item) => {
    imageCounts[item.productId] = item._count.id;
  });

  // Process tests
  for (const test of allTests) {
    // Initialize product stats
    if (!productStats[test.productId]) {
      productStats[test.productId] = {
        imageCount: imageCounts[test.productId] || 0,
        hasActiveTest: false,
        testCount: 0,
      };
    }
    productStats[test.productId].testCount++;

    // Check if active test
    if (test.status === 'ACTIVE' || test.status === 'PAUSED') {
      productStats[test.productId].hasActiveTest = true;

      // Calculate stats
      const baseEvents = test.events.filter((e) => e.activeCase === 'BASE');
      const testEvents = test.events.filter((e) => e.activeCase === 'TEST');

      const baseImpressions = baseEvents.filter((e) => e.eventType === 'IMPRESSION').length;
      const testImpressions = testEvents.filter((e) => e.eventType === 'IMPRESSION').length;
      const baseConversions = baseEvents.filter((e) => e.eventType === 'PURCHASE').length;
      const testConversions = testEvents.filter((e) => e.eventType === 'PURCHASE').length;

      const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
      const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;
      const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

      // Find product info
      const product = products.find(p => p.id === test.productId);

      activeTests.push({
        id: test.id,
        name: test.name,
        productId: test.productId,
        productTitle: product?.title || 'Unknown Product',
        productImage: product?.featuredImage?.url,
        status: test.status,
        currentCase: test.currentCase,
        impressions: baseImpressions + testImpressions,
        conversions: baseConversions + testConversions,
        cvr: (baseImpressions + testImpressions) > 0
          ? ((baseConversions + testConversions) / (baseImpressions + testImpressions)) * 100
          : 0,
        lift,
      });
    }
  }

  // Add image counts to products without tests
  products.forEach(product => {
    if (!productStats[product.id]) {
      productStats[product.id] = {
        imageCount: imageCounts[product.id] || 0,
        hasActiveTest: false,
        testCount: 0,
      };
    }
  });

  return json({ products, activeTests, productStats });
};

export default function Index() {
  const { products, activeTests, productStats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  // Sort products: active tests first, then by image count
  const sortedProducts = [...products].sort((a, b) => {
    const aStats = productStats[a.id] || { hasActiveTest: false, imageCount: 0 };
    const bStats = productStats[b.id] || { hasActiveTest: false, imageCount: 0 };

    // Active tests first
    if (aStats.hasActiveTest && !bStats.hasActiveTest) return -1;
    if (!aStats.hasActiveTest && bStats.hasActiveTest) return 1;

    // Then by test count
    if ((aStats.testCount || 0) !== (bStats.testCount || 0)) {
      return (bStats.testCount || 0) - (aStats.testCount || 0);
    }

    // Then by image count
    return (bStats.imageCount || 0) - (aStats.imageCount || 0);
  });

  const filteredProducts = sortedProducts.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectProduct = (productId: string) => {
    navigate(`/app/products/${encodeURIComponent(productId)}`);
  };

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">
        {/* Header */}
        <BlockStack gap="200">
          <Text variant="headingLg" as="h1">
            Welcome to Dreamshot A/B Test App
          </Text>
          <Text tone="subdued" as="p">
            Optimize your product images with AI-powered A/B testing
          </Text>
        </BlockStack>

        {/* Section 1: Active Tests */}
        {activeTests.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Active Tests
                </Text>
                <Badge tone="success">{activeTests.length} running</Badge>
              </InlineStack>

              <BlockStack gap="300">
                {activeTests.map((test) => (
                  <div
                    key={test.id}
                    onClick={() => handleSelectProduct(test.productId)}
                    style={{
                      padding: "12px 16px",
                      backgroundColor: "#F1F8F5",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#E3F1EB";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "#F1F8F5";
                    }}
                  >
                    <InlineStack gap="400" align="space-between" wrap={false}>
                      <InlineStack gap="300" wrap={false}>
                        {test.productImage && (
                          <img
                            src={test.productImage}
                            alt=""
                            style={{
                              width: "48px",
                              height: "48px",
                              objectFit: "cover",
                              borderRadius: "6px",
                              border: "1px solid #E1E3E5",
                            }}
                          />
                        )}
                        <BlockStack gap="100">
                          <InlineStack gap="200">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {test.productTitle}
                            </Text>
                            <Badge tone={test.status === "ACTIVE" ? "success" : "attention"}>
                              {test.status}
                            </Badge>
                            <Badge tone={test.currentCase === "BASE" ? "info" : "attention"}>
                              {test.currentCase}
                            </Badge>
                          </InlineStack>
                          <Text as="span" tone="subdued" variant="bodySm">
                            {test.name}
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <InlineStack gap="600">
                        <BlockStack gap="0">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Impressions
                          </Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {test.impressions.toLocaleString()}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="0">
                          <Text as="span" variant="bodySm" tone="subdued">
                            CVR
                          </Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {test.cvr.toFixed(2)}%
                          </Text>
                        </BlockStack>
                        <BlockStack gap="0">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Lift
                          </Text>
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                            tone={test.lift > 0 ? "success" : test.lift < 0 ? "critical" : undefined}
                          >
                            {test.lift > 0 ? "+" : ""}{test.lift.toFixed(1)}%
                          </Text>
                        </BlockStack>
                        <Button
                          size="slim"
                          onClick={() => navigate(`/app/products/${encodeURIComponent(test.productId)}?tab=tests`)}
                        >
                          View
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* No active tests message */}
        {activeTests.length === 0 && (
          <Card>
            <BlockStack gap="300" align="center" inlineAlign="center">
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                }}
              >
                <Text variant="headingMd" as="h3">
                  No Active Tests
                </Text>
                <Text tone="subdued" as="p">
                  Select a product below to create your first A/B test
                </Text>
              </div>
            </BlockStack>
          </Card>
        )}

        <Divider />

        {/* Section 2: All Products */}
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  All Products
                </Text>
                <Text as="span" tone="subdued">
                  {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}
                </Text>
              </InlineStack>
              <TextField
                label=""
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
              />
            </BlockStack>
          </Card>

          {filteredProducts.length === 0 ? (
            <Card>
              <EmptyState
                heading={searchQuery ? "No products match your search" : "No products found"}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {searchQuery
                    ? "Try adjusting your search"
                    : "Create products in your store to get started"}
                </p>
              </EmptyState>
            </Card>
          ) : (
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
              {filteredProducts.map((product) => {
                const stats = productStats[product.id] || { imageCount: 0, hasActiveTest: false, testCount: 0 };

                return (
                  <Card key={product.id}>
                    <BlockStack gap="300">
                      <div
                        onClick={() => handleSelectProduct(product.id)}
                        style={{
                          cursor: "pointer",
                          borderRadius: "8px",
                          overflow: "hidden",
                          aspectRatio: "1",
                          backgroundColor: "#F6F6F7",
                          position: "relative",
                        }}
                      >
                        {product.featuredImage?.url ? (
                          <img
                            src={product.featuredImage.url}
                            alt={product.featuredImage.altText || product.title}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text as="p" tone="subdued">
                              No image
                            </Text>
                          </div>
                        )}
                        {/* Status badges overlay */}
                        <div
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          {stats.hasActiveTest && (
                            <Badge tone="success">Active Test</Badge>
                          )}
                          {!stats.hasActiveTest && stats.testCount > 0 && (
                            <Badge tone="info">{stats.testCount} test{stats.testCount !== 1 ? "s" : ""}</Badge>
                          )}
                        </div>
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingMd" truncate>
                          {product.title}
                        </Text>
                        <InlineStack align="space-between">
                          <InlineStack gap="200">
                            {stats.imageCount > 0 && (
                              <Badge>{stats.imageCount} image{stats.imageCount !== 1 ? "s" : ""}</Badge>
                            )}
                          </InlineStack>
                          <button
                            onClick={() => handleSelectProduct(product.id)}
                            style={{
                              background: "#008060",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              padding: "8px 16px",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: "500",
                            }}
                          >
                            Open
                          </button>
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </InlineGrid>
          )}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}
