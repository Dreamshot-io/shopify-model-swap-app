import { useState } from "react";
import {
  Modal,
  BlockStack,
  Text,
  Checkbox,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import type { ProductVariant } from "../types";

interface VariantPublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (variantIds: string[]) => void;
  variants: ProductVariant[];
  imageUrl: string;
}

export function VariantPublishDialog({
  isOpen,
  onClose,
  onPublish,
  variants,
  imageUrl,
}: VariantPublishDialogProps) {
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [publishToAll, setPublishToAll] = useState(true);

  const handleToggleVariant = (variantId: string) => {
    setSelectedVariantIds((prev) => {
      if (prev.includes(variantId)) {
        return prev.filter((id) => id !== variantId);
      } else {
        return [...prev, variantId];
      }
    });
    setPublishToAll(false);
  };

  const handleToggleAll = () => {
    if (publishToAll) {
      setPublishToAll(false);
      setSelectedVariantIds([]);
    } else {
      setPublishToAll(true);
      setSelectedVariantIds(variants.map((v) => v.id));
    }
  };

  const handlePublish = () => {
    const variantIdsToPublish = publishToAll
      ? variants.map((v) => v.id)
      : selectedVariantIds;

    onPublish(variantIdsToPublish);
    onClose();

    // Reset state
    setPublishToAll(true);
    setSelectedVariantIds([]);
  };

  const getVariantDisplayText = (variant: ProductVariant) => {
    const optionsText = variant.selectedOptions
      .map((opt) => opt.value)
      .join(" / ");
    return optionsText || variant.title || variant.displayName;
  };

  // If no variants or only one, don't show complex dialog
  if (!variants || variants.length <= 1) {
    return (
      <Modal
        open={isOpen}
        onClose={onClose}
        title="Publish to product?"
        primaryAction={{
          content: "Publish",
          onAction: () => {
            onPublish(variants.length === 1 ? [variants[0].id] : []);
            onClose();
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: onClose,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <div
              style={{
                width: "200px",
                borderRadius: "8px",
                overflow: "hidden",
                border: "1px solid #E1E3E5",
              }}
            >
              <img
                src={imageUrl}
                alt="Preview"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <Text as="p">
              This will add the image to your product's media gallery.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    );
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Publish image to variants"
      primaryAction={{
        content: `Publish to ${publishToAll ? "all variants" : `${selectedVariantIds.length} variant${selectedVariantIds.length === 1 ? "" : "s"}`}`,
        onAction: handlePublish,
        disabled: !publishToAll && selectedVariantIds.length === 0,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Preview Image */}
          <div
            style={{
              width: "200px",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid #E1E3E5",
            }}
          >
            <img
              src={imageUrl}
              alt="Preview"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>

          <Text as="p" tone="subdued">
            Select which variants should display this image:
          </Text>

          {/* All Variants Option */}
          <Checkbox
            label={
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  All Variants
                </Text>
                <Badge>{variants.length} variants</Badge>
              </InlineStack>
            }
            checked={publishToAll}
            onChange={handleToggleAll}
          />

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid #E1E3E5",
              margin: "8px 0",
            }}
          />

          {/* Individual Variant Checkboxes */}
          <BlockStack gap="300">
            {variants.map((variant) => (
              <div
                key={variant.id}
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  border: "1px solid #E1E3E5",
                  backgroundColor: selectedVariantIds.includes(variant.id)
                    ? "#F0F8F6"
                    : "white",
                }}
              >
                <Checkbox
                  label={
                    <InlineStack gap="300" blockAlign="center">
                      {/* Variant Image Thumbnail */}
                      {variant.image?.url && (
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "4px",
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
                      <BlockStack gap="50">
                        <Text as="span" fontWeight="medium">
                          {getVariantDisplayText(variant)}
                        </Text>
                        {variant.sku && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            SKU: {variant.sku}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                  }
                  checked={publishToAll || selectedVariantIds.includes(variant.id)}
                  onChange={() => handleToggleVariant(variant.id)}
                  disabled={publishToAll}
                />
              </div>
            ))}
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
