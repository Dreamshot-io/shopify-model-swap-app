import {
    Card,
    Text,
    Button,
    BlockStack,
    InlineStack,
    Badge,
    Grid,
    ProgressBar,
    Collapsible,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import type { ABTestStats, SerializedABTest } from "../types";

interface ABTestCardProps {
  test: SerializedABTest;
  stats: ABTestStats;
  onStart?: () => void;
  onStop?: () => void;
  onView?: () => void;
  onDelete?: () => void;
  isLoading?: boolean;
}

export function ABTestCard({
  test,
  stats,
  onStart,
  onStop,
  onView,
  onDelete,
  isLoading = false,
}: ABTestCardProps) {
  const [showDetails, setShowDetails] = useState(false);
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

  const variantAImages = (() => {
    const imageUrls = test.variants.find((v) => v.variant === "A")?.imageUrls;
    try {
      return imageUrls ? JSON.parse(imageUrls) : [];
    } catch {
      return [];
    }
  })();

  const variantBImages = (() => {
    const imageUrls = test.variants.find((v) => v.variant === "B")?.imageUrls;
    try {
      return imageUrls ? JSON.parse(imageUrls) : [];
    } catch {
      return [];
    }
  })();

  return (
    <Card>
      <BlockStack gap="300">
        {/* Compact Header with Key Metrics */}
        <InlineStack align="space-between" wrap={false}>
          <BlockStack gap="100">
            <InlineStack gap="200" align="start" wrap={false}>
              <Text as="h3" variant="headingMd">
                {test.name}
              </Text>
              {getStatusBadge(test.status)}
            </InlineStack>
            <InlineStack gap="300" wrap={false}>
              <Text as="span" variant="bodySm" tone="subdued">
                Views:{" "}
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {stats.sampleSize}
                </Text>
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                Confidence:{" "}
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {stats.confidence}%
                </Text>
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                Lift:{" "}
                <Text
                  as="span"
                  variant="bodySm"
                  fontWeight="semibold"
                  tone={parseFloat(stats.lift) > 0 ? "success" : "critical"}
                >
                  {stats.lift}%
                </Text>
              </Text>
              {stats.isSignificant && stats.winner && (
                <Text as="span" variant="bodySm" tone="success">
                  Winner: Variant {stats.winner}
                </Text>
              )}
            </InlineStack>
          </BlockStack>

          {/* Inline Actions */}
          <InlineStack gap="200" align="end">
            <Button
              size="slim"
              variant="tertiary"
              onClick={() => setShowDetails(!showDetails)}
              icon={showDetails ? ChevronUpIcon : ChevronDownIcon}
            >
              {showDetails ? "Less" : "Details"}
            </Button>
            {test.status === "DRAFT" && onStart && (
              <Button
                size="slim"
                variant="primary"
                onClick={onStart}
                disabled={isLoading}
              >
                Start
              </Button>
            )}
            {test.status === "RUNNING" && onStop && (
              <Button
                size="slim"
                tone="critical"
                onClick={onStop}
                disabled={isLoading}
              >
                Stop
              </Button>
            )}
            {onDelete && (
              <Button
                size="slim"
                variant="tertiary"
                tone="critical"
                onClick={onDelete}
                disabled={isLoading}
              >
                Delete
              </Button>
            )}
          </InlineStack>
        </InlineStack>

        {/* Progress indicator */}
        <ProgressBar
          progress={Math.min(parseFloat(stats.confidence), 95)}
          tone={stats.isSignificant ? "success" : "primary"}
          size="small"
        />

        {/* Compact Variants Preview */}
        <InlineStack gap="400" align="space-between">
          <InlineStack gap="200" align="start">
            <BlockStack gap="100">
              <InlineStack gap="100" align="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Variant A
                  {stats.winner === "A" && stats.isSignificant && (
                    <span style={{ marginLeft: "4px" }}>🏆</span>
                  )}
                </Text>
                <InlineStack gap="50" wrap={false}>
                  {variantAImages
                    .slice(0, 2)
                    .map((url: string, index: number) => (
                      <div
                        key={index}
                        style={{
                          width: "24px",
                          height: "30px",
                          borderRadius: "2px",
                          overflow: "hidden",
                          border: "1px solid #E1E3E5",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={url}
                          alt={`A${index + 1}`}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    ))}
                  {variantAImages.length > 2 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      +{variantAImages.length - 2}
                    </Text>
                  )}
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {stats.variantA.impressions.toLocaleString()} views •{" "}
                {stats.variantA.ratePercent} rate
              </Text>
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200" align="start">
            <BlockStack gap="100">
              <InlineStack gap="100" align="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Variant B
                  {stats.winner === "B" && stats.isSignificant && (
                    <span style={{ marginLeft: "4px" }}>🏆</span>
                  )}
                </Text>
                <InlineStack gap="50" wrap={false}>
                  {variantBImages
                    .slice(0, 2)
                    .map((url: string, index: number) => (
                      <div
                        key={index}
                        style={{
                          width: "24px",
                          height: "30px",
                          borderRadius: "2px",
                          overflow: "hidden",
                          border: "1px solid #E1E3E5",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={url}
                          alt={`B${index + 1}`}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    ))}
                  {variantBImages.length > 2 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      +{variantBImages.length - 2}
                    </Text>
                  )}
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {stats.variantB.impressions.toLocaleString()} views •{" "}
                {stats.variantB.ratePercent} rate
              </Text>
            </BlockStack>
          </InlineStack>
        </InlineStack>

        {/* Collapsible Detailed Stats */}
        <Collapsible open={showDetails}>
          <BlockStack gap="300">
            <Grid columns={{ xs: 2, md: 4 }}>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  A: Add to Cart
                </Text>
                <Text as="p" variant="headingSm">
                  {stats.variantA.addToCarts?.toLocaleString() || "0"}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  B: Add to Cart
                </Text>
                <Text as="p" variant="headingSm">
                  {stats.variantB.addToCarts?.toLocaleString() || "0"}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  A: Purchases
                </Text>
                <Text as="p" variant="headingSm">
                  {stats.variantA.purchases?.toLocaleString() || "0"}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  B: Purchases
                </Text>
                <Text as="p" variant="headingSm">
                  {stats.variantB.purchases?.toLocaleString() || "0"}
                </Text>
              </BlockStack>
            </Grid>

            <Grid columns={{ xs: 2, md: 4 }}>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  A: Revenue
                </Text>
                <Text as="p" variant="headingSm">
                  ${(stats.variantA.revenue || 0).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  B: Revenue
                </Text>
                <Text as="p" variant="headingSm">
                  ${(stats.variantB.revenue || 0).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  Product ID
                </Text>
                <Text as="p" variant="bodySm">
                  {test.productId.replace("gid://shopify/Product/", "")}
                </Text>
              </BlockStack>
              <BlockStack gap="50">
                <Text as="p" variant="bodySm" tone="subdued">
                  Traffic Split
                </Text>
                <Text as="p" variant="bodySm">
                  {test.trafficSplit || 50}% / {100 - (test.trafficSplit || 50)}
                  %
                </Text>
              </BlockStack>
            </Grid>
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
