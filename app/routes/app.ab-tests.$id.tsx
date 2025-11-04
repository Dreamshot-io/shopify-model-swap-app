import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  Banner,
  Grid,
  Badge,
  ProgressBar,
  InlineStack, DataTable,
  Button,
  Modal
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { calculateStatistics } from "../features/ab-testing/utils/statistics";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const testId = params.id;

  if (!testId) {
    throw new Response("Test ID required", { status: 400 });
  }

  const abTest = await db.aBTest.findFirst({
    where: {
      id: testId,
      shop: session.shop,
    },
    include: {
      variants: true,
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!abTest) {
    throw new Response("Test not found", { status: 404 });
  }

  // Fetch product variants if this is a variant-scoped test
  let productVariants: any[] = [];
  if (abTest.variantScope === 'VARIANT') {
    try {
      const response = await admin.graphql(
        `#graphql
        query GetProductVariants($id: ID!) {
          product(id: $id) {
            variants(first: 100) {
              nodes {
                id
                title
                displayName
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }`,
        {
          variables: { id: abTest.productId },
        },
      );

      const responseJson = await response.json();
      productVariants = responseJson.data?.product?.variants?.nodes || [];
    } catch (error) {
      console.error('[AB Test Details] Failed to fetch product variants:', error);
    }
  }

  const serialized = {
    ...abTest,
    createdAt: abTest.createdAt.toISOString(),
    updatedAt: abTest.updatedAt.toISOString(),
    startDate: abTest.startDate?.toISOString() ?? null,
    endDate: abTest.endDate?.toISOString() ?? null,
    events: abTest.events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
    variants: abTest.variants.map((v: any) => {
      try {
        if (!v.imageUrls || v.imageUrls === 'undefined' || v.imageUrls === 'null' || v.imageUrls === '') {
          return { ...v, imageUrls: [] };
        }
        return { ...v, imageUrls: JSON.parse(v.imageUrls) };
      } catch {
        return { ...v, imageUrls: [] };
      }
    }),
  };

  return json({ abTest: serialized, productVariants });
};

export default function ABTestDetails() {
  const { abTest, productVariants } = useLoaderData<typeof loader>();
  const stats = calculateStatistics(abTest.events);
  const [previewVariant, setPreviewVariant] = useState<{
    variant: "A" | "B";
    images: string[];
    variantTitle?: string;
  } | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge tone="attention">Draft</Badge>;
      case "RUNNING":
        return <Badge tone="success">Running</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "ARCHIVED":
        return <Badge>Archived</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatVariantTitle = (variant: any): string => {
    if (!variant) return 'Unknown';
    if (variant.title === 'Default Title') {
      return 'Default Variant';
    }
    const options = variant.selectedOptions?.map((opt: any) => opt.value).join(' / ');
    return options || variant.title || 'Unknown';
  };

  const getShopifyVariant = (shopifyVariantId: string | null) => {
    if (!shopifyVariantId || !productVariants) return null;
    return productVariants.find((v: any) => v.id === shopifyVariantId) || null;
  };

  const isVariantScoped = abTest.variantScope === 'VARIANT';

  // For product-scoped tests, use existing logic
  const variantAImages = isVariantScoped
    ? []
    : (abTest.variants.find((v: any) => v.variant === "A" && !v.shopifyVariantId)?.imageUrls || []);
  const variantBImages = isVariantScoped
    ? []
    : (abTest.variants.find((v: any) => v.variant === "B" && !v.shopifyVariantId)?.imageUrls || []);

  return (
    <Page
      backAction={{ url: "/app/ab-tests" }}
      title={abTest.name}
      subtitle={`Product ID: ${abTest.productId}`}
    >
      <TitleBar title={`A/B Test: ${abTest.name}`} />

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Test Overview */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">Test Overview</Text>
                  {getStatusBadge(abTest.status)}
                </InlineStack>

                <Grid columns={{ xs: 1, sm: 2, md: 4 }}>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">
                      Total Impressions
                    </Text>
                    <Text variant="headingLg">{stats.sampleSize}</Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">
                      Confidence Level
                    </Text>
                    <Text variant="headingLg">{stats.confidence}%</Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">
                      Lift
                    </Text>
                    <Text
                      variant="headingLg"
                      tone={parseFloat(stats.lift) > 0 ? "success" : "critical"}
                    >
                      {stats.lift}%
                    </Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">
                      Winner
                    </Text>
                    <Text variant="headingLg">
                      {stats.isSignificant
                        ? stats.winner
                          ? `Variant ${stats.winner}`
                          : "Tie"
                        : "TBD"}
                    </Text>
                  </Card>
                </Grid>

                {stats.isSignificant && (
                  <Banner tone="success">
                    <Text as="p">
                      Statistical significance achieved! Variant {stats.winner}{" "}
                      is performing {Math.abs(parseFloat(stats.lift))}%{" "}
                      {parseFloat(stats.lift) > 0 ? "better" : "worse"} than the
                      other variant.
                    </Text>
                  </Banner>
                )}

                {!stats.isSignificant && stats.sampleSize > 100 && (
                  <Banner tone="info">
                    <Text as="p">
                      Test needs more data to reach statistical significance
                      (95% confidence). Current confidence: {stats.confidence}%
                    </Text>
                  </Banner>
                )}

                <ProgressBar
                  progress={Math.min(parseFloat(stats.confidence), 95)}
                  color="primary"
                  tone="primary"
                />
              </BlockStack>
            </Card>

            {/* Variant Performance */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">Variant Performance</Text>
                  {isVariantScoped && (
                    <Badge tone="info">Variant-Scoped Test</Badge>
                  )}
                </InlineStack>

                {isVariantScoped ? (
                  // Variant-scoped test: show each product variant separately
                  <BlockStack gap="400">
                    {(() => {
                      // Group variants by shopifyVariantId
                      const variantGroups = new Map<string, { variantA: any; variantB: any }>();
                      abTest.variants.forEach((v: any) => {
                        const key = v.shopifyVariantId || 'null';
                        if (!variantGroups.has(key)) {
                          variantGroups.set(key, { variantA: null, variantB: null });
                        }
                        const group = variantGroups.get(key)!;
                        if (v.variant === 'A') {
                          group.variantA = v;
                        } else if (v.variant === 'B') {
                          group.variantB = v;
                        }
                      });

                      return Array.from(variantGroups.entries()).map(([shopifyVariantId, group]) => {
                        const shopifyVariant = getShopifyVariant(shopifyVariantId);
                        const variantTitle = shopifyVariant
                          ? formatVariantTitle(shopifyVariant)
                          : shopifyVariantId === 'null'
                            ? 'Product-Wide'
                            : `Variant ${shopifyVariantId.substring(0, 8)}...`;

                        const variantAImages = group.variantA?.imageUrls || [];
                        const variantBImages = group.variantB?.imageUrls || [];

                        return (
                          <Card key={shopifyVariantId} background="subdued">
                            <BlockStack gap="300">
                              <Text variant="headingSm" fontWeight="semibold">
                                {variantTitle}
                              </Text>
                              <DataTable
                                columnContentTypes={[
                                  "text",
                                  "numeric",
                                  "numeric",
                                  "numeric",
                                  "numeric",
                                  "text",
                                ]}
                                headings={[
                                  "Images",
                                  "Impressions",
                                  "ATC",
                                  "Purchases",
                                  "Revenue",
                                  "Preview",
                                ]}
                                rows={[
                                  [
                                    <div
                                      key="variant-a-images"
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "12px",
                                      }}
                                    >
                                      <InlineStack gap="200" wrap={false} align="center">
                                        <Text variant="headingMd">
                                          Variant A
                                          {stats.winner === "A" && stats.isSignificant && (
                                            <span style={{ marginLeft: "8px" }}>🏆</span>
                                          )}
                                        </Text>
                                        <InlineStack gap="100" wrap={false}>
                                          {variantAImages.slice(0, 5).map((url: string, index: number) => (
                                            <div
                                              key={index}
                                              style={{
                                                width: "40px",
                                                height: "40px",
                                                borderRadius: "4px",
                                                overflow: "hidden",
                                                border: "1px solid #E1E3E5",
                                                flexShrink: 0,
                                              }}
                                            >
                                              <img
                                                src={url}
                                                alt={`Variant A option ${index + 1}`}
                                                style={{
                                                  width: "100%",
                                                  height: "100%",
                                                  objectFit: "cover",
                                                }}
                                              />
                                            </div>
                                          ))}
                                          {variantAImages.length > 5 && (
                                            <Text variant="bodySm" tone="subdued">
                                              +{variantAImages.length - 5}
                                            </Text>
                                          )}
                                          {variantAImages.length === 0 && (
                                            <Text variant="bodySm" tone="subdued">
                                              No images
                                            </Text>
                                          )}
                                        </InlineStack>
                                      </InlineStack>
                                    </div>,
                                    stats.variantA.impressions.toLocaleString(),
                                    stats.variantA.addToCarts.toLocaleString(),
                                    stats.variantA.purchases.toLocaleString(),
                                    `$${stats.variantA.revenue.toFixed(2)}`,
                                    <Button
                                      key="variant-a-preview"
                                      size="micro"
                                      onClick={() =>
                                        setPreviewVariant({
                                          variant: "A",
                                          images: variantAImages,
                                          variantTitle,
                                        })
                                      }
                                    >
                                      👁️ Preview
                                    </Button>,
                                  ],
                                  [
                                    <div
                                      key="variant-b-images"
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "12px",
                                      }}
                                    >
                                      <InlineStack gap="200" wrap={false} align="center">
                                        <Text variant="headingMd">
                                          Variant B
                                          {stats.winner === "B" && stats.isSignificant && (
                                            <span style={{ marginLeft: "8px" }}>🏆</span>
                                          )}
                                        </Text>
                                        <InlineStack gap="100" wrap={false}>
                                          {variantBImages.slice(0, 5).map((url: string, index: number) => (
                                            <div
                                              key={index}
                                              style={{
                                                width: "40px",
                                                height: "40px",
                                                borderRadius: "4px",
                                                overflow: "hidden",
                                                border: "1px solid #E1E3E5",
                                                flexShrink: 0,
                                              }}
                                            >
                                              <img
                                                src={url}
                                                alt={`Variant B option ${index + 1}`}
                                                style={{
                                                  width: "100%",
                                                  height: "100%",
                                                  objectFit: "cover",
                                                }}
                                              />
                                            </div>
                                          ))}
                                          {variantBImages.length > 5 && (
                                            <Text variant="bodySm" tone="subdued">
                                              +{variantBImages.length - 5}
                                            </Text>
                                          )}
                                          {variantBImages.length === 0 && (
                                            <Text variant="bodySm" tone="subdued">
                                              No images
                                            </Text>
                                          )}
                                        </InlineStack>
                                      </InlineStack>
                                    </div>,
                                    stats.variantB.impressions.toLocaleString(),
                                    stats.variantB.addToCarts.toLocaleString(),
                                    stats.variantB.purchases.toLocaleString(),
                                    `$${stats.variantB.revenue.toFixed(2)}`,
                                    <Button
                                      key="variant-b-preview"
                                      size="micro"
                                      onClick={() =>
                                        setPreviewVariant({
                                          variant: "B",
                                          images: variantBImages,
                                          variantTitle,
                                        })
                                      }
                                    >
                                      👁️ Preview
                                    </Button>,
                                  ],
                                ]}
                              />
                            </BlockStack>
                          </Card>
                        );
                      });
                    })()}
                  </BlockStack>
                ) : (
                  // Product-scoped test: existing logic
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "numeric",
                      "numeric",
                      "numeric",
                      "numeric",
                      "text",
                    ]}
                    headings={[
                      "Images",
                      "Impressions",
                      "ATC",
                      "Purchases",
                      "Revenue",
                      "Preview",
                    ]}
                    rows={[
                      [
                        <div
                          key="variant-a-images"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <InlineStack gap="200" wrap={false} align="center">
                            <Text variant="headingMd">
                              Variant A
                              {stats.winner === "A" && stats.isSignificant && (
                                <span style={{ marginLeft: "8px" }}>🏆</span>
                              )}
                            </Text>
                            <InlineStack gap="100" wrap={false}>
                              {variantAImages
                                .slice(0, 5)
                                .map((url: string, index: number) => (
                                  <div
                                    key={index}
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                      borderRadius: "4px",
                                      overflow: "hidden",
                                      border: "1px solid #E1E3E5",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <img
                                      src={url}
                                      alt={`Variant A option ${index + 1}`}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                      }}
                                    />
                                  </div>
                                ))}
                              {variantAImages.length > 5 && (
                                <Text variant="bodySm" tone="subdued">
                                  +{variantAImages.length - 5}
                                </Text>
                              )}
                            </InlineStack>
                          </InlineStack>
                        </div>,
                        stats.variantA.impressions.toLocaleString(),
                        stats.variantA.addToCarts.toLocaleString(),
                        stats.variantA.purchases.toLocaleString(),
                        `$${stats.variantA.revenue.toFixed(2)}`,
                        <Button
                          key="variant-a-preview"
                          size="micro"
                          onClick={() =>
                            setPreviewVariant({
                              variant: "A",
                              images: variantAImages,
                            })
                          }
                        >
                          👁️ Preview
                        </Button>,
                      ],
                      [
                        <div
                          key="variant-b-images"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <InlineStack gap="200" wrap={false} align="center">
                            <Text variant="headingMd">
                              Variant B
                              {stats.winner === "B" && stats.isSignificant && (
                                <span style={{ marginLeft: "8px" }}>🏆</span>
                              )}
                            </Text>
                            <InlineStack gap="100" wrap={false}>
                              {variantBImages
                                .slice(0, 5)
                                .map((url: string, index: number) => (
                                  <div
                                    key={index}
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                      borderRadius: "4px",
                                      overflow: "hidden",
                                      border: "1px solid #E1E3E5",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <img
                                      src={url}
                                      alt={`Variant B option ${index + 1}`}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                      }}
                                    />
                                  </div>
                                ))}
                              {variantBImages.length > 5 && (
                                <Text variant="bodySm" tone="subdued">
                                  +{variantBImages.length - 5}
                                </Text>
                              )}
                            </InlineStack>
                          </InlineStack>
                        </div>,
                        stats.variantB.impressions.toLocaleString(),
                        stats.variantB.addToCarts.toLocaleString(),
                        stats.variantB.purchases.toLocaleString(),
                        `$${stats.variantB.revenue.toFixed(2)}`,
                        <Button
                          key="variant-b-preview"
                          size="micro"
                          onClick={() =>
                            setPreviewVariant({
                              variant: "B",
                              images: variantBImages,
                            })
                          }
                        >
                          👁️ Preview
                        </Button>,
                      ],
                    ]}
                  />
                )}
              </BlockStack>
            </Card>

            {/* Test Timeline */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Test Timeline</Text>
                <Grid columns={{ xs: 1, sm: 3 }}>
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">
                      Created
                    </Text>
                    <Text variant="bodyMd">
                      {new Date(abTest.createdAt).toLocaleDateString()}
                    </Text>
                  </BlockStack>
                  {abTest.startDate && (
                    <BlockStack gap="100">
                      <Text variant="bodyMd" tone="subdued">
                        Started
                      </Text>
                      <Text variant="bodyMd">
                        {new Date(abTest.startDate).toLocaleDateString()}
                      </Text>
                    </BlockStack>
                  )}
                  {abTest.endDate && (
                    <BlockStack gap="100">
                      <Text variant="bodyMd" tone="subdued">
                        Ended
                      </Text>
                      <Text variant="bodyMd">
                        {new Date(abTest.endDate).toLocaleDateString()}
                      </Text>
                    </BlockStack>
                  )}
                </Grid>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Product Preview Modal */}
      {previewVariant && (
        <Modal
          open={true}
          onClose={() => setPreviewVariant(null)}
          title={`Product Preview - Variant ${previewVariant.variant}${previewVariant.variantTitle ? ` (${previewVariant.variantTitle})` : ''}`}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h3">
                How your product{previewVariant.variantTitle ? ` variant "${previewVariant.variantTitle}"` : ''} would look with Variant{" "}
                {previewVariant.variant} images:
              </Text>

              {/* Product Mock-up */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="bodyMd" tone="subdued">
                    Product ID:{" "}
                    {abTest.productId.replace("gid://shopify/Product/", "")}
                  </Text>

                  {/* Main product image area */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "24px",
                      backgroundColor: "#F6F6F7",
                      borderRadius: "12px",
                      minHeight: "400px",
                    }}
                  >
                    {/* Primary Image */}
                    <div
                      style={{
                        width: "100%",
                        maxWidth: "400px",
                        marginBottom: "24px",
                      }}
                    >
                      <img
                        src={previewVariant.images[0]}
                        alt={`Variant ${previewVariant.variant} primary image`}
                        style={{
                          width: "100%",
                          height: "auto",
                          borderRadius: "8px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                          border: "2px solid #FFFFFF",
                        }}
                      />
                    </div>

                    {/* Image Gallery Thumbnails */}
                    {previewVariant.images.length > 1 && (
                      <div>
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          alignment="center"
                        >
                          Additional images:
                        </Text>
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            marginTop: "12px",
                            justifyContent: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {previewVariant.images
                            .slice(1, 6)
                            .map((url, index) => (
                              <div
                                key={index}
                                style={{
                                  width: "60px",
                                  height: "60px",
                                  borderRadius: "6px",
                                  overflow: "hidden",
                                  border: "1px solid #E1E3E5",
                                  flexShrink: 0,
                                }}
                              >
                                <img
                                  src={url}
                                  alt={`Variant ${previewVariant.variant} image ${index + 2}`}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }}
                                />
                              </div>
                            ))}
                          {previewVariant.images.length > 6 && (
                            <div
                              style={{
                                width: "60px",
                                height: "60px",
                                borderRadius: "6px",
                                backgroundColor: "#E1E3E5",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #E1E3E5",
                              }}
                            >
                              <Text variant="bodySm" tone="subdued">
                                +{previewVariant.images.length - 6}
                              </Text>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Product Page Simulation */}
                  <BlockStack gap="300">
                    <Text variant="headingLg" as="h2">
                      [Product Title]
                    </Text>
                    <Text variant="bodyLg">$XX.XX</Text>
                    <Text variant="bodyMd" tone="subdued">
                      This is how your product page would appear to customers
                      seeing Variant {previewVariant.variant} images. The
                      primary image above would be the main product photo, with
                      additional images available in the gallery.
                    </Text>

                    {/* Mock Add to Cart */}
                    <div style={{ marginTop: "16px" }}>
                      <Button variant="primary" size="large" disabled>
                        Add to Cart (Preview Mode)
                      </Button>
                    </div>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Variant Comparison */}
              <Banner tone="info">
                <Text as="p">
                  <strong>A/B Test Insight:</strong> This variant has{" "}
                  {stats.variantA.impressions} impressions with a{" "}
                  {previewVariant.variant === "A"
                    ? stats.variantA.ratePercent
                    : stats.variantB.ratePercent}
                  % conversion rate.
                  {stats.isSignificant &&
                    stats.winner === previewVariant.variant &&
                    " 🏆 This is the winning variant!"}
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
