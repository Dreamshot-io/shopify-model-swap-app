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
  InlineStack,
  Thumbnail,
  DataTable,
  Button,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const testId = params.id;

  if (!testId) {
    throw new Response("Test ID required", { status: 400 });
  }

  const abTest = await db.aBTest.findFirst({
    where: { 
      id: testId,
      shop: session.shop 
    },
    include: {
      variants: true,
      events: true,
    },
  });

  if (!abTest) {
    throw new Response("Test not found", { status: 404 });
  }

  return json({ abTest });
};

function calculateStatistics(events: any[]) {
  const variantAEvents = events.filter(e => e.variant === "A");
  const variantBEvents = events.filter(e => e.variant === "B");

  const variantAImpressions = variantAEvents.filter(e => e.eventType === "IMPRESSION").length;
  const variantBImpressions = variantBEvents.filter(e => e.eventType === "IMPRESSION").length;

  const variantAAddToCarts = variantAEvents.filter(e => e.eventType === "ADD_TO_CART").length;
  const variantBAddToCarts = variantBEvents.filter(e => e.eventType === "ADD_TO_CART").length;

  const variantAPurchases = variantAEvents.filter(e => e.eventType === "PURCHASE").length;
  const variantBPurchases = variantBEvents.filter(e => e.eventType === "PURCHASE").length;

  const variantARevenue = variantAEvents
    .filter(e => e.eventType === "PURCHASE")
    .reduce((sum, e) => sum + (e.revenue || 0), 0);
  const variantBRevenue = variantBEvents
    .filter(e => e.eventType === "PURCHASE")
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  const variantARate = variantAImpressions > 0 ? (variantAAddToCarts / variantAImpressions) : 0;
  const variantBRate = variantBImpressions > 0 ? (variantBAddToCarts / variantBImpressions) : 0;

  // Calculate statistical significance using z-test
  const n1 = variantAImpressions;
  const n2 = variantBImpressions;
  const p1 = variantARate;
  const p2 = variantBRate;

  let zScore = 0;
  let pValue = 1;
  let confidence = 0;

  if (n1 > 0 && n2 > 0) {
    const pooledP = (variantAAddToCarts + variantBAddToCarts) / (n1 + n2);
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/n1 + 1/n2));
    
    if (se > 0) {
      zScore = (p1 - p2) / se;
      // Approximate p-value calculation
      pValue = 2 * (1 - Math.abs(zScore) / Math.sqrt(2 * Math.PI));
      confidence = Math.max(0, (1 - pValue) * 100);
    }
  }

  return {
    variantA: {
      impressions: variantAImpressions,
      addToCarts: variantAAddToCarts,
      purchases: variantAPurchases,
      revenue: variantARevenue,
      conversions: variantAAddToCarts, // backwards compatibility
      rate: variantARate,
      ratePercent: (variantARate * 100).toFixed(2)
    },
    variantB: {
      impressions: variantBImpressions,
      addToCarts: variantBAddToCarts,
      purchases: variantBPurchases,
      revenue: variantBRevenue,
      conversions: variantBAddToCarts, // backwards compatibility
      rate: variantBRate,
      ratePercent: (variantBRate * 100).toFixed(2)
    },
    lift: ((variantBRate - variantARate) / Math.max(variantARate, 0.001) * 100).toFixed(2),
    confidence: confidence.toFixed(1),
    isSignificant: confidence >= 95,
    winner: variantBRate > variantARate ? "B" : variantARate > variantBRate ? "A" : null,
    sampleSize: n1 + n2
  };
}

export default function ABTestDetails() {
  const { abTest } = useLoaderData<typeof loader>();
  const stats = calculateStatistics(abTest.events);
  const [previewVariant, setPreviewVariant] = useState<{ variant: "A" | "B"; images: string[] } | null>(null);

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

  const variantAImages = JSON.parse(abTest.variants.find((v: any) => v.variant === "A")?.imageUrls || "[]");
  const variantBImages = JSON.parse(abTest.variants.find((v: any) => v.variant === "B")?.imageUrls || "[]");

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
                    <Text variant="bodyMd" tone="subdued">Total Impressions</Text>
                    <Text variant="headingLg">{stats.sampleSize}</Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">Confidence Level</Text>
                    <Text variant="headingLg">{stats.confidence}%</Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">Lift</Text>
                    <Text variant="headingLg" tone={parseFloat(stats.lift) > 0 ? "success" : "critical"}>
                      {stats.lift}%
                    </Text>
                  </Card>
                  <Card>
                    <Text variant="bodyMd" tone="subdued">Winner</Text>
                    <Text variant="headingLg">
                      {stats.isSignificant ? (stats.winner ? `Variant ${stats.winner}` : "Tie") : "TBD"}
                    </Text>
                  </Card>
                </Grid>

                {stats.isSignificant && (
                  <Banner tone="success">
                    <Text as="p">
                      Statistical significance achieved! Variant {stats.winner} is performing {Math.abs(parseFloat(stats.lift))}% {parseFloat(stats.lift) > 0 ? "better" : "worse"} than the other variant.
                    </Text>
                  </Banner>
                )}

                {!stats.isSignificant && stats.sampleSize > 100 && (
                  <Banner tone="info">
                    <Text as="p">
                      Test needs more data to reach statistical significance (95% confidence). Current confidence: {stats.confidence}%
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
                <Text variant="headingMd">Variant Performance</Text>
                
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "text"]}
                  headings={["Images", "Impressions", "ATC", "Purchases", "Revenue", "Preview"]}
                  rows={[
                    [
                      <div key="variant-a-images" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                                  alt={`Variant A image ${index + 1}`}
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
                      stats.variantA.addToCarts?.toLocaleString() || "0",
                      stats.variantA.purchases?.toLocaleString() || "0",
                      `$${(stats.variantA.revenue || 0).toFixed(2)}`,
                      <Button
                        key="variant-a-preview"
                        size="micro"
                        onClick={() => setPreviewVariant({ variant: "A", images: variantAImages })}
                      >
                        👁️ Preview
                      </Button>,
                    ],
                    [
                      <div key="variant-b-images" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                                  alt={`Variant B image ${index + 1}`}
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
                      stats.variantB.addToCarts?.toLocaleString() || "0",
                      stats.variantB.purchases?.toLocaleString() || "0",
                      `$${(stats.variantB.revenue || 0).toFixed(2)}`,
                      <Button
                        key="variant-b-preview"
                        size="micro"
                        onClick={() => setPreviewVariant({ variant: "B", images: variantBImages })}
                      >
                        👁️ Preview
                      </Button>,
                    ],
                  ]}
                />
              </BlockStack>
            </Card>

            {/* Test Timeline */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Test Timeline</Text>
                <Grid columns={{ xs: 1, sm: 3 }}>
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">Created</Text>
                    <Text variant="bodyMd">{new Date(abTest.createdAt).toLocaleDateString()}</Text>
                  </BlockStack>
                  {abTest.startDate && (
                    <BlockStack gap="100">
                      <Text variant="bodyMd" tone="subdued">Started</Text>
                      <Text variant="bodyMd">{new Date(abTest.startDate).toLocaleDateString()}</Text>
                    </BlockStack>
                  )}
                  {abTest.endDate && (
                    <BlockStack gap="100">
                      <Text variant="bodyMd" tone="subdued">Ended</Text>
                      <Text variant="bodyMd">{new Date(abTest.endDate).toLocaleDateString()}</Text>
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
          title={`Product Preview - Variant ${previewVariant.variant}`}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h3">
                How your product would look with Variant {previewVariant.variant} images:
              </Text>
              
              {/* Product Mock-up */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="bodyMd" tone="subdued">
                    Product ID: {abTest.productId.replace("gid://shopify/Product/", "")}
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
                        <Text variant="bodySm" tone="subdued" alignment="center">
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
                          {previewVariant.images.slice(1, 6).map((url, index) => (
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
                    <Text variant="bodyLg">
                      $XX.XX
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      This is how your product page would appear to customers seeing Variant {previewVariant.variant} images. 
                      The primary image above would be the main product photo, with additional images available in the gallery.
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
                  <strong>A/B Test Insight:</strong> This variant has {stats.variantA.impressions} impressions 
                  with a {previewVariant.variant === "A" ? stats.variantA.ratePercent : stats.variantB.ratePercent}% conversion rate.
                  {stats.isSignificant && stats.winner === previewVariant.variant && 
                    " 🏆 This is the winning variant!"
                  }
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}