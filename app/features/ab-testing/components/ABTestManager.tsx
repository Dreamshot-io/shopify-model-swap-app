import { useState, useCallback } from "react";
import {
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { ABTestCreator } from "./ABTestCreator";
import { ABTestCard } from "./ABTestCard";
import { ABTestSummary } from "./ABTestSummary";
import type { ABTest, ABTestStats, ABTestCreateRequest } from "../types";

interface ABTestManagerProps {
  productId: string;
  availableImages: string[];
  existingTests?: ABTest[];
  activeTest?: ABTest | null;
  onTestCreate: (request: ABTestCreateRequest) => Promise<void>;
  onTestAction?: (testId: string, action: "start" | "stop" | "delete") => void;
  isCreating?: boolean;
}

export function ABTestManager({
  productId,
  availableImages,
  existingTests = [],
  activeTest = null,
  onTestCreate,
  onTestAction,
  isCreating = false,
}: ABTestManagerProps) {
  const [showCreator, setShowCreator] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateTest = useCallback(
    async (request: ABTestCreateRequest) => {
      setIsSubmitting(true);
      try {
        await onTestCreate(request);
        setShowCreator(false);
      } catch (error) {
        console.error("Failed to create A/B test:", error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [onTestCreate],
  );

  // Mock stats for demonstration - in real implementation, these would come from props or API
  const getMockStats = (test: ABTest): ABTestStats => ({
    variantA: {
      impressions: Math.floor(Math.random() * 1000) + 100,
      addToCarts: Math.floor(Math.random() * 50) + 10,
      purchases: Math.floor(Math.random() * 20),
      revenue: Math.floor(Math.random() * 5000),
      conversions: Math.floor(Math.random() * 50) + 10,
      rate: 0.12,
      ratePercent: "12.5",
    },
    variantB: {
      impressions: Math.floor(Math.random() * 1000) + 100,
      addToCarts: Math.floor(Math.random() * 50) + 10,
      purchases: Math.floor(Math.random() * 20),
      revenue: Math.floor(Math.random() * 5000),
      conversions: Math.floor(Math.random() * 50) + 10,
      rate: 0.15,
      ratePercent: "15.2",
    },
    lift: "+21.6",
    confidence: "87",
    isSignificant: false,
    winner: null,
    sampleSize: Math.floor(Math.random() * 2000) + 500,
  });

  if (availableImages.length === 0) {
    return (
      <Card>
        <EmptyState
          heading="No images available"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p">
            You need at least 2 images to create an A/B test. Generate some AI
            images or add product images first.
          </Text>
        </EmptyState>
      </Card>
    );
  }

  if (availableImages.length < 2) {
    return (
      <Card>
        <Banner tone="warning">
          <Text as="p">
            You need at least 2 images to create an A/B test. You currently have{" "}
            {availableImages.length} image(s) available.
          </Text>
        </Banner>
      </Card>
    );
  }

  const getSummaryStats = () => {
    const runningTests = existingTests.filter(
      (test) => test.status === "RUNNING",
    ).length;
    const totalImpressions = existingTests.length * 850; // Mock data
    const avgLift = existingTests.length > 0 ? "+18.5" : "0"; // Mock data

    return {
      totalTests: existingTests.length,
      runningTests,
      totalImpressions,
      avgLift,
    };
  };

  return (
    <BlockStack gap="500">
      {/* Compact Header */}
      <Card>
        <InlineStack align="space-between" wrap={false}>
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              A/B Testing
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Optimize your product images with A/B tests
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            {activeTest && !showCreator && (
              <Text
                as="span"
                variant="bodySm"
                tone="success"
                fontWeight="semibold"
              >
                Active test running
              </Text>
            )}
            {showCreator && (
              <Button
                variant="tertiary"
                onClick={() => setShowCreator(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            )}
            {!showCreator && !activeTest && (
              <Button
                variant="primary"
                onClick={() => setShowCreator(true)}
                disabled={availableImages.length < 2}
              >
                Create Test
              </Button>
            )}
          </InlineStack>
        </InlineStack>
      </Card>

      {/* A/B Test Creator - only show if no active test */}
      {showCreator && !activeTest && (
        <ABTestCreator
          productId={productId}
          availableImages={availableImages}
          onTestCreate={handleCreateTest}
          isCreating={isSubmitting}
        />
      )}

      {/* Compressed Overview & Tests Table */}
      {existingTests.length > 0 && (
        <Card>
          <BlockStack gap="400">
            {/* Compact Header with Key Stats */}
            <InlineStack align="space-between" wrap={false}>
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  A/B Test Results
                </Text>
                <InlineStack gap="400" wrap={false}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Tests:{" "}
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {getSummaryStats().totalTests}
                    </Text>
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Active:{" "}
                    <Text
                      as="span"
                      variant="bodySm"
                      fontWeight="semibold"
                      tone="success"
                    >
                      {getSummaryStats().runningTests}
                    </Text>
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Impressions:{" "}
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {getSummaryStats().totalImpressions.toLocaleString()}
                    </Text>
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Avg. Lift:{" "}
                    <Text
                      as="span"
                      variant="bodySm"
                      fontWeight="semibold"
                      tone="success"
                    >
                      {getSummaryStats().avgLift}%
                    </Text>
                  </Text>
                </InlineStack>
              </BlockStack>
            </InlineStack>

            {/* Tests Table */}
            <BlockStack gap="300">
              {existingTests.map((test) => {
                const stats = getMockStats(test);
                const variantAImages = (() => {
                  const imageUrls = test.variants.find(
                    (v) => v.variant === "A",
                  )?.imageUrls;
                  try {
                    if (!imageUrls) return [];
                    // Handle cases where imageUrls might already be a string[]
                    return Array.isArray(imageUrls)
                      ? imageUrls
                      : JSON.parse(imageUrls as unknown as string);
                  } catch {
                    return [];
                  }
                })();

                const variantBImages = (() => {
                  const imageUrls = test.variants.find(
                    (v) => v.variant === "B",
                  )?.imageUrls;
                  try {
                    if (!imageUrls) return [];
                    return Array.isArray(imageUrls)
                      ? imageUrls
                      : JSON.parse(imageUrls as unknown as string);
                  } catch {
                    return [];
                  }
                })();

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

                return (
                  <Card key={test.id}>
                    <BlockStack gap="300">
                      {/* Test Header */}
                      <InlineStack align="space-between" wrap={false}>
                        <InlineStack gap="200" align="start">
                          <Text as="h4" variant="headingSm">
                            {test.name}
                          </Text>
                          {getStatusBadge(test.status)}
                        </InlineStack>
                        <InlineStack gap="200">
                          {test.status === "DRAFT" && (
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => onTestAction?.(test.id, "start")}
                            >
                              Start
                            </Button>
                          )}
                          {test.status === "RUNNING" && (
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => onTestAction?.(test.id, "stop")}
                            >
                              Stop
                            </Button>
                          )}
                          <Button
                            size="slim"
                            variant="tertiary"
                            tone="critical"
                            onClick={() => onTestAction?.(test.id, "delete")}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>

                      {/* Variants Comparison Table (Transposed) */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "auto auto auto auto auto auto auto",
                          gap: "12px",
                          alignItems: "center",
                        }}
                      >
                        {/* Header Row: empty cell for Variant label */}
                        <div />
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Images
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Impressions
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          ATC
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Purchases
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Revenue
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          CVR
                        </Text>

                        {/* Variant A Row */}
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          A{" "}
                          {stats.winner === "A" && stats.isSignificant && "🏆"}
                        </Text>
                        <InlineStack gap="100" wrap={false}>
                          {variantAImages
                            .slice(0, 3)
                            .map((url: string, index: number) => (
                              <div
                                key={index}
                                style={{
                                  width: "84px",
                                  height: "84px",
                                  borderRadius: "4px",
                                  overflow: "hidden",
                                  border: "1px solid #E1E3E5",
                                  flexShrink: 0,
                                }}
                              >
                                <img
                                  src={url}
                                  alt={`A${index + 1}`}
                                  style={{
                                    maxWidth: "100%",
                                    maxHeight: "100%",
                                    width: "auto",
                                    height: "auto",
                                    objectFit: "contain",
                                    display: "block",
                                    margin: "0 auto",
                                  }}
                                />
                              </div>
                            ))}
                          {variantAImages.length > 3 && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              +{variantAImages.length - 3}
                            </Text>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm">
                          {stats.variantA.impressions.toLocaleString()}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {stats.variantA.conversions.toLocaleString()}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {(
                            stats.variantA as any
                          ).purchases?.toLocaleString() || "0"}
                        </Text>
                        <Text as="span" variant="bodySm">
                          ${((stats.variantA as any).revenue || 0).toFixed(2)}
                        </Text>
                        <Text
                          as="span"
                          variant="bodySm"
                          tone={stats.winner === "A" ? "success" : undefined}
                        >
                          {stats.variantA.ratePercent}%
                        </Text>

                        {/* Variant B Row */}
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          B{" "}
                          {stats.winner === "B" && stats.isSignificant && "🏆"}
                        </Text>
                        <InlineStack gap="100" wrap={false}>
                          {variantBImages
                            .slice(0, 3)
                            .map((url: string, index: number) => (
                              <div
                                key={index}
                                style={{
                                  width: "84px",
                                  height: "84px",
                                  borderRadius: "4px",
                                  overflow: "hidden",
                                  border: "1px solid #E1E3E5",
                                  flexShrink: 0,
                                }}
                              >
                                <img
                                  src={url}
                                  alt={`B${index + 1}`}
                                  style={{
                                    maxWidth: "100%",
                                    maxHeight: "100%",
                                    width: "auto",
                                    height: "auto",
                                    objectFit: "contain",
                                    display: "block",
                                    margin: "0 auto",
                                  }}
                                />
                              </div>
                            ))}
                          {variantBImages.length > 3 && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              +{variantBImages.length - 3}
                            </Text>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm">
                          {stats.variantB.impressions.toLocaleString()}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {stats.variantB.conversions.toLocaleString()}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {(
                            stats.variantB as any
                          ).purchases?.toLocaleString() || "0"}
                        </Text>
                        <Text as="span" variant="bodySm">
                          ${((stats.variantB as any).revenue || 0).toFixed(2)}
                        </Text>
                        <Text
                          as="span"
                          variant="bodySm"
                          tone={stats.winner === "B" ? "success" : undefined}
                        >
                          {stats.variantB.ratePercent}%
                        </Text>
                      </div>

                      {/* Summary Footer */}
                      <InlineStack gap="400" align="start">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Lift:{" "}
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="semibold"
                            tone={
                              parseFloat(stats.lift) > 0
                                ? "success"
                                : "critical"
                            }
                          >
                            {stats.lift}%
                          </Text>
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Confidence:{" "}
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="semibold"
                          >
                            {stats.confidence}%
                          </Text>
                        </Text>
                        {stats.isSignificant && (
                          <Text
                            as="span"
                            variant="bodySm"
                            tone="success"
                            fontWeight="semibold"
                          >
                            ✓ Significant
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {/* Empty State for No Tests */}
      {existingTests.length === 0 && !showCreator && (
        <Card>
          <EmptyState
            heading="No A/B tests created yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <Text as="p">
              Start optimizing your product images by creating your first A/B
              test. Compare different image variants to see which performs
              better.
            </Text>
            <div style={{ marginTop: "16px" }}>
              <Button
                variant="primary"
                onClick={() => setShowCreator(true)}
                disabled={availableImages.length < 2 || !!activeTest}
              >
                Create Your First Test
              </Button>
            </div>
          </EmptyState>
        </Card>
      )}
    </BlockStack>
  );
}
