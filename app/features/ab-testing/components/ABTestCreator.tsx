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
  isCreating = false 
}: ABTestCreatorProps) {
  const [testName, setTestName] = useState("");
  const [variantAImages, setVariantAImages] = useState<string[]>([]);
  const [variantBImages, setVariantBImages] = useState<string[]>([]);
  const [trafficSplit, setTrafficSplit] = useState("50");
  const [selectedVariant, setSelectedVariant] = useState<"A" | "B">("A");

  const handleImageToggle = (imageUrl: string, variant: "A" | "B") => {
    if (variant === "A") {
      setVariantAImages(prev => 
        prev.includes(imageUrl) 
          ? prev.filter(url => url !== imageUrl)
          : [...prev, imageUrl]
      );
      // Remove from B if it exists there
      setVariantBImages(prev => prev.filter(url => url !== imageUrl));
    } else {
      setVariantBImages(prev => 
        prev.includes(imageUrl) 
          ? prev.filter(url => url !== imageUrl)
          : [...prev, imageUrl]
      );
      // Remove from A if it exists there
      setVariantAImages(prev => prev.filter(url => url !== imageUrl));
    }
  };

  const handleSubmit = () => {
    if (!testName || variantAImages.length === 0 || variantBImages.length === 0) {
      return;
    }

    onTestCreate({
      name: testName,
      productId,
      variantAImages,
      variantBImages,
      trafficSplit: parseInt(trafficSplit),
    });
  };

  const isValid = testName && variantAImages.length > 0 && variantBImages.length > 0;

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="h2" variant="headingLg">Create A/B Test</Text>
          <Text variant="bodyMd" tone="subdued">
            Set up an A/B test to compare different image variants and measure their impact on conversions.
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
              <Text as="h3" variant="headingMd">Test Summary</Text>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Variant A Images:</Text>
                    <Text variant="bodyMd" tone={variantAImages.length > 0 ? "success" : "subdued"}>
                      {variantAImages.length} selected
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Variant B Images:</Text>
                    <Text variant="bodyMd" tone={variantBImages.length > 0 ? "success" : "subdued"}>
                      {variantBImages.length} selected
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Traffic Split:</Text>
                    <Text variant="bodyMd">{trafficSplit}% / {100 - parseInt(trafficSplit)}%</Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </BlockStack>

          <BlockStack gap="300">
            <InlineStack align="space-between" wrap={false}>
              <Text as="h3" variant="headingMd">Select Images</Text>
              <InlineStack gap="200">
                <Button
                  size="micro"
                  variant={selectedVariant === "A" ? "primary" : "secondary"}
                  onClick={() => setSelectedVariant("A")}
                >
                  Variant A ({variantAImages.length})
                </Button>
                <Button
                  size="micro"
                  variant={selectedVariant === "B" ? "primary" : "secondary"}
                  onClick={() => setSelectedVariant("B")}
                >
                  Variant B ({variantBImages.length})
                </Button>
              </InlineStack>
            </InlineStack>

            <Card>
              <Box padding="300">
                <Grid columns={{ xs: 2, sm: 3, md: 4 }}>
                  {availableImages.map((imageUrl, index) => {
                    const isSelected = selectedVariant === "A" 
                      ? variantAImages.includes(imageUrl)
                      : variantBImages.includes(imageUrl);
                    
                    return (
                      <div
                        key={`${selectedVariant}-${index}`}
                        style={{
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                        onClick={() => handleImageToggle(imageUrl, selectedVariant)}
                      >
                        <div
                          style={{
                            border: isSelected
                              ? "3px solid #008060"
                              : "2px solid #E1E3E5",
                            borderRadius: "12px",
                            padding: "8px",
                            backgroundColor: isSelected ? "#F0FAF7" : "#FFFFFF",
                            transform: isSelected ? "scale(1.02)" : "scale(1)",
                            boxShadow: isSelected 
                              ? "0 4px 12px rgba(0, 128, 96, 0.15)"
                              : "0 2px 4px rgba(0, 0, 0, 0.05)",
                          }}
                        >
                          <img
                            src={imageUrl}
                            alt={`Image ${index + 1}`}
                            style={{
                              width: "100%",
                              height: "120px",
                              objectFit: "cover",
                              borderRadius: "8px",
                            }}
                          />
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
                                fontSize: "12px",
                                fontWeight: "bold",
                              }}
                            >
                              ✓
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Grid>
              </Box>
            </Card>

            <Text variant="bodySm" tone="subdued" alignment="center">
              Click images to add them to {selectedVariant === "A" ? "Variant A" : "Variant B"}. 
              Switch between variants using the buttons above.
            </Text>
          </BlockStack>
        </Grid>

        <Divider />

        <InlineStack align="end" gap="200">
          <Text variant="bodySm" tone={isValid ? "success" : "critical"}>
            {!testName && "Please enter a test name. "}
            {variantAImages.length === 0 && "Select images for Variant A. "}
            {variantBImages.length === 0 && "Select images for Variant B. "}
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