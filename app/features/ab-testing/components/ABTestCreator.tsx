import { useState } from "react";
import {
  Card,
  Text,
  Button,
  BlockStack,
  FormLayout,
  TextField,
  Select,
  InlineStack,
  Grid,
  Box,
  Divider,
} from "@shopify/polaris";
import type { ABTestCreateRequest } from "../types";

interface ABTestCreatorProps {
  productId: string;
  availableImages: string[];
  onTestCreate: (request: ABTestCreateRequest) => void;
  isCreating?: boolean;
}

export function ABTestCreator({
  productId,
  availableImages,
  onTestCreate,
  isCreating = false,
}: ABTestCreatorProps) {
  const [testName, setTestName] = useState("");
  // Use Maps to track selection order with timestamps
  const [variantAImages, setVariantAImages] = useState<Map<string, number>>(
    new Map(),
  );
  const [variantBImages, setVariantBImages] = useState<Map<string, number>>(
    new Map(),
  );
  const [trafficSplit, setTrafficSplit] = useState("50");
  const [selectedVariant, setSelectedVariant] = useState<"A" | "B">("A");
  const [selectionCounter, setSelectionCounter] = useState(0);

  const handleImageToggle = (imageUrl: string, variant: "A" | "B") => {
    if (variant === "A") {
      setVariantAImages((prev) => {
        const newMap = new Map(prev);
        if (newMap.has(imageUrl)) {
          newMap.delete(imageUrl);
        } else {
          newMap.set(imageUrl, selectionCounter);
          setSelectionCounter((c) => c + 1);
        }
        return newMap;
      });
    } else {
      setVariantBImages((prev) => {
        const newMap = new Map(prev);
        if (newMap.has(imageUrl)) {
          newMap.delete(imageUrl);
        } else {
          newMap.set(imageUrl, selectionCounter);
          setSelectionCounter((c) => c + 1);
        }
        return newMap;
      });
    }
  };

  const handleSubmit = () => {
    if (!testName || variantAImages.size === 0 || variantBImages.size === 0) {
      return;
    }

    const sortedAImages = Array.from(variantAImages.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([url]) => url)
      .slice(0, 6);

    const filteredBEntries = Array.from(variantBImages.entries())
      .sort((a, b) => a[1] - b[1])
      .filter(([url]) => !sortedAImages.includes(url));

    const sortedBImages = filteredBEntries.map(([url]) => url).slice(0, 6);

    if (sortedAImages.length === 0 || sortedBImages.length === 0) {
      alert("Each variant must contain at least one unique image (max 6 per variant)");
      return;
    }

    onTestCreate({
      name: testName,
      productId,
      variantAImages: sortedAImages,
      variantBImages: sortedBImages,
      trafficSplit: parseInt(trafficSplit),
    });
  };

  const variantASelection = Array.from(variantAImages.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([url]) => url);

  const variantBSelection = Array.from(variantBImages.entries())
    .sort((a, b) => a[1] - b[1])
    .filter(([url]) => !variantASelection.includes(url))
    .map(([url]) => url);

  const isValid =
    testName && variantASelection.length > 0 && variantBSelection.length > 0;

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="h2" variant="headingLg">
            Create A/B Test
          </Text>
          <Text variant="bodyMd" tone="subdued">
            Set up an A/B test to compare different image variants and measure
            their impact on conversions.
          </Text>
        </BlockStack>

        <Divider />

        <Grid columns={{ xs: 1, lg: 2 }}>
          <BlockStack gap="400">
            <FormLayout>
              <TextField
                label="Test Name"
                value={testName}
                onChange={setTestName}
                placeholder="e.g., Hero Image Comparison Test"
                autoComplete="off"
                helpText="Give your test a descriptive name for easy identification"
              />

              <Select
                label="Traffic Split"
                options={[
                  { label: "50/50 Split (Recommended)", value: "50" },
                  { label: "60/40 Split (A/B)", value: "60" },
                  { label: "40/60 Split (A/B)", value: "40" },
                  { label: "70/30 Split (A/B)", value: "70" },
                  { label: "30/70 Split (A/B)", value: "30" },
                ]}
                value={trafficSplit}
                onChange={setTrafficSplit}
                helpText="Percentage of traffic that will see Variant A"
              />
            </FormLayout>

            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Test Summary
              </Text>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Variant A Images:</Text>
                    <Text
                      variant="bodyMd"
                      tone={variantAImages.size > 0 ? "success" : "subdued"}
                    >
                      {variantAImages.size} selected
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Variant B Images:</Text>
                    <Text
                      variant="bodyMd"
                      tone={variantBImages.size > 0 ? "success" : "subdued"}
                    >
                      {variantBImages.size} selected
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Traffic Split:</Text>
                    <Text variant="bodyMd">
                      {trafficSplit}% / {100 - parseInt(trafficSplit)}%
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </BlockStack>

          <BlockStack gap="300">
            <InlineStack align="space-between" wrap={false}>
              <Text as="h3" variant="headingMd">
                Select Images
              </Text>
              <InlineStack gap="200">
                <Button
                  size="micro"
                  variant={selectedVariant === "A" ? "primary" : "secondary"}
                  onClick={() => setSelectedVariant("A")}
                >
                  Variant A ({variantAImages.size})
                </Button>
                <Button
                  size="micro"
                  variant={selectedVariant === "B" ? "primary" : "secondary"}
                  onClick={() => setSelectedVariant("B")}
                >
                  Variant B ({variantBImages.size})
                </Button>
              </InlineStack>
            </InlineStack>

            <Card>
              <Box padding="300">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {availableImages.map((imageUrl, index) => {
                    const variantAMap = variantAImages;
                    const variantBMap = variantBImages;

                    const isSelectedA = variantAMap.has(imageUrl);
                    const isSelectedB = variantBMap.has(imageUrl);
                    const isSelected =
                      selectedVariant === "A" ? isSelectedA : isSelectedB;

                    // Get the selection order for display
                    let selectionOrder: number | null = null;
                    if (isSelectedA) {
                      const allAEntries = Array.from(
                        variantAMap.entries(),
                      ).sort((a, b) => a[1] - b[1]);
                      selectionOrder =
                        allAEntries.findIndex(([url]) => url === imageUrl) + 1;
                    } else if (isSelectedB) {
                      const allBEntries = Array.from(
                        variantBMap.entries(),
                      ).sort((a, b) => a[1] - b[1]);
                      selectionOrder =
                        allBEntries.findIndex(([url]) => url === imageUrl) + 1;
                    }

                    // Determine which variant this image belongs to
                    const imageVariant = isSelectedA
                      ? "A"
                      : isSelectedB
                        ? "B"
                        : null;

                    return (
                      <div
                        key={`${selectedVariant}-${index}`}
                        style={{
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          position: "relative",
                        }}
                        onClick={() =>
                          handleImageToggle(imageUrl, selectedVariant)
                        }
                      >
                        <div
                          style={{
                            border: isSelected
                              ? "3px solid #008060"
                              : isSelectedA || isSelectedB
                                ? "2px solid #FFA500"
                                : "2px solid #E1E3E5",
                            borderRadius: "12px",
                            padding: "8px",
                            backgroundColor: isSelected
                              ? "#F0FAF7"
                              : isSelectedA || isSelectedB
                                ? "#FFF5E6"
                                : "#FFFFFF",
                            transform: isSelected ? "scale(1.02)" : "scale(1)",
                            boxShadow: isSelected
                              ? "0 4px 12px rgba(0, 128, 96, 0.15)"
                              : isSelectedA || isSelectedB
                                ? "0 2px 8px rgba(255, 165, 0, 0.1)"
                                : "0 2px 4px rgba(0, 0, 0, 0.05)",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              maxHeight: "180px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                              borderRadius: "8px",
                              backgroundColor: "#F6F6F7",
                            }}
                          >
                            <img
                              src={imageUrl}
                              alt={`Image ${index + 1}`}
                              style={{
                                maxWidth: "100%",
                                maxHeight: "180px",
                                width: "auto",
                                height: "auto",
                                objectFit: "contain",
                                borderRadius: "8px",
                              }}
                            />
                          </div>
                          {(isSelectedA || isSelectedB) && (
                            <>
                              {/* Selection order badge */}
                              <div
                                style={{
                                  position: "absolute",
                                  top: "12px",
                                  left: "12px",
                                  backgroundColor:
                                    imageVariant === "A"
                                      ? "#008060"
                                      : "#0066CC",
                                  color: "white",
                                  borderRadius: "12px",
                                  padding: "2px 8px",
                                  display: "flex",
                                  alignItems: "center",
                                  fontSize: "11px",
                                  fontWeight: "bold",
                                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                                }}
                              >
                                {imageVariant} #{selectionOrder}
                              </div>

                              {/* Check mark for currently selected variant */}
                              {isSelected && (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: "12px",
                                    right: "12px",
                                    backgroundColor: "#008060",
                                    color: "white",
                                    borderRadius: "50%",
                                    width: "24px",
                                    height: "24px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "14px",
                                    fontWeight: "bold",
                                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                                  }}
                                >
                                  ✓
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Box>
            </Card>

            <Text variant="bodySm" tone="subdued" alignment="center">
              Click images to add them to{" "}
              {selectedVariant === "A" ? "Variant A" : "Variant B"}. Switch
              between variants using the buttons above. Images can be added to both variants.
            </Text>
          </BlockStack>
        </Grid>

        <Divider />

        <InlineStack align="end" gap="200">
          <Text variant="bodySm" tone={isValid ? "success" : "critical"}>
            {!testName && "Please enter a test name. "}
            {variantAImages.size === 0 && "Select images for Variant A. "}
            {variantBImages.size === 0 && "Select images for Variant B. "}
            {isValid && "Ready to create A/B test!"}
          </Text>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isValid || isCreating}
            loading={isCreating}
            size="large"
          >
            {isCreating ? "Creating Test..." : "Create A/B Test"}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
