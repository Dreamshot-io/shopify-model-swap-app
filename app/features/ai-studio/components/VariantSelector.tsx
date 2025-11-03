import { useState } from "react";
import {
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Popover,
  Button,
  Box,
} from "@shopify/polaris";
import type { ProductVariant } from "../types";

interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedVariantId: string | null; // null = "All Variants"
  onSelect: (variantId: string | null) => void;
}

export function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: VariantSelectorProps) {
  const [popoverActive, setPopoverActive] = useState(false);

  // If no variants or only one variant (default), don't show selector
  if (!variants || variants.length <= 1) {
    return null;
  }

  // Get selected variant or null for "All Variants"
  const selectedVariant = selectedVariantId
    ? variants.find((v) => v.id === selectedVariantId)
    : null;

  // Build display text for selected variant
  const getVariantDisplayText = (variant: ProductVariant | null) => {
    if (!variant) return "All Variants";

    // Show variant options in a readable format
    const optionsText = variant.selectedOptions
      .map((opt) => opt.value)
      .join(" / ");

    return optionsText || variant.title || variant.displayName;
  };

  const togglePopover = () => setPopoverActive((active) => !active);

  const activator = (
    <Button
      onClick={togglePopover}
      disclosure={popoverActive ? "up" : "down"}
      fullWidth
    >
      <InlineStack gap="200" align="center" blockAlign="center">
        <Text as="span" variant="bodyMd">
          {getVariantDisplayText(selectedVariant)}
        </Text>
        {selectedVariant && (
          <Badge tone="info">{variants.length} variants</Badge>
        )}
        {!selectedVariant && (
          <Badge>{variants.length} variants</Badge>
        )}
      </InlineStack>
    </Button>
  );

  return (
    <Popover
      active={popoverActive}
      activator={activator}
      onClose={togglePopover}
      preferredAlignment="left"
      fullWidth
    >
      <Box padding="300">
        <BlockStack gap="200">
          {/* All Variants Option */}
          <button
            onClick={() => {
              onSelect(null);
              setPopoverActive(false);
            }}
            style={{
              width: "100%",
              padding: "12px",
              border: "2px solid #E1E3E5",
              borderRadius: "8px",
              background:
                selectedVariantId === null ? "#F0F8F6" : "white",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.2s ease",
            }}
          >
            <InlineStack gap="300" align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  All Variants
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  Show images for all variants
                </Text>
              </BlockStack>
              {selectedVariantId === null && (
                <Badge tone="success">Selected</Badge>
              )}
            </InlineStack>
          </button>

          {/* Individual Variants */}
          {variants.map((variant) => {
            const isSelected = selectedVariantId === variant.id;
            const optionsText = variant.selectedOptions
              .map((opt) => `${opt.name}: ${opt.value}`)
              .join(", ");

            return (
              <button
                key={variant.id}
                onClick={() => {
                  onSelect(variant.id);
                  setPopoverActive(false);
                }}
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "2px solid #E1E3E5",
                  borderRadius: "8px",
                  background: isSelected ? "#F0F8F6" : "white",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.2s ease",
                }}
              >
                <InlineStack gap="300" align="space-between" blockAlign="center">
                  <InlineStack gap="300" align="start" blockAlign="center">
                    {/* Variant Image Thumbnail */}
                    {variant.image?.url && (
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "6px",
                          overflow: "hidden",
                          backgroundColor: "#F6F6F7",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={variant.image.url}
                          alt={variant.image.altText || "Variant"}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    )}

                    {/* Variant Info */}
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {getVariantDisplayText(variant)}
                      </Text>
                      {variant.sku && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          SKU: {variant.sku}
                        </Text>
                      )}
                      {optionsText && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {optionsText}
                        </Text>
                      )}
                    </BlockStack>
                  </InlineStack>

                  {isSelected && <Badge tone="success">Selected</Badge>}
                </InlineStack>
              </button>
            );
          })}
        </BlockStack>
      </Box>
    </Popover>
  );
}
