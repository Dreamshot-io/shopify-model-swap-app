import { useState, useMemo } from "react";
import {
    Card,
    Text,
    BlockStack,
    InlineGrid,
    Button,
    Modal,
    InlineStack,
    EmptyState,
    Badge,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import type { LibraryItem, ProductVariant } from "../types";

interface MediaNode {
  id: string;
  alt?: string | null;
  image?: {
    url: string;
    altText?: string | null;
    width?: number;
    height?: number;
  } | null;
}

interface ProductGalleryProps {
  images: MediaNode[];
  libraryItems?: LibraryItem[];
  onDelete: (mediaId: string) => void;
  onPublishFromLibrary?: (url: string) => void;
  onRemoveFromLibrary?: (url: string) => void;
  isDeleting: boolean;
  selectedVariantId?: string | null; // null = "All Variants"
  variants?: ProductVariant[];
}

export function ProductGallery({
  images,
  libraryItems = [],
  onDelete,
  onPublishFromLibrary,
  onRemoveFromLibrary,
  isDeleting,
  selectedVariantId,
  variants = [],
}: ProductGalleryProps) {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [libraryToDelete, setLibraryToDelete] = useState<string | null>(null);

  // Filter library items by selected variant
  const filteredLibraryItems = useMemo(() => {
    if (!selectedVariantId) return libraryItems; // Show all if no filter

    return libraryItems.filter((item) => {
      if (typeof item === "string") return true; // Legacy format = show for all
      if (!item.variantIds || item.variantIds.length === 0) return true; // No variants specified = all
      return item.variantIds.includes(selectedVariantId); // Has this variant
    });
  }, [libraryItems, selectedVariantId]);

  // Helper to get variant names for an item
  const getVariantNames = (item: LibraryItem): string[] => {
    if (typeof item === "string" || !item.variantIds || item.variantIds.length === 0) {
      return ["All Variants"];
    }

    return item.variantIds
      .map((variantId) => {
        const variant = variants.find((v) => v.id === variantId);
        if (!variant) return null;
        return variant.selectedOptions.map((opt) => opt.value).join(" / ");
      })
      .filter(Boolean) as string[];
  };

  const handleDeleteClick = (mediaId: string) => {
    setSelectedMediaId(mediaId);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (selectedMediaId) {
      onDelete(selectedMediaId);
      setDeleteModalOpen(false);
      setSelectedMediaId(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteModalOpen(false);
    setSelectedMediaId(null);
  };

  const handleLibraryDeleteClick = (url: string) => {
    setLibraryToDelete(url);
  };

  const handleConfirmLibraryDelete = () => {
    if (libraryToDelete && onRemoveFromLibrary) {
      onRemoveFromLibrary(libraryToDelete);
      setLibraryToDelete(null);
    }
  };

  const productImages = images.filter((node) => node.image?.url);
  const totalImages = productImages.length + filteredLibraryItems.length;

  if (totalImages === 0) {
    return (
      <Card>
        <EmptyState
          heading="No product images"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p">
            This product doesn't have any images yet. Use the Image Generation
            section below to create and publish images, or upload images manually.
          </Text>
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">
              Product Gallery
            </Text>
            <InlineStack gap="200">
              {productImages.length > 0 && (
                <Badge tone="info">
                  {productImages.length} published
                </Badge>
              )}
              {filteredLibraryItems.length > 0 && (
                <Badge>
                  {filteredLibraryItems.length} in library
                  {selectedVariantId && libraryItems.length !== filteredLibraryItems.length &&
                    ` (${libraryItems.length} total)`}
                </Badge>
              )}
            </InlineStack>
          </InlineStack>

          <InlineGrid columns={{ xs: 3, sm: 5, md: 7, lg: 8 }} gap="400">
            {/* Published images */}
            {productImages.map((node) => {
              if (!node.image?.url) return null;

              return (
                <div
                  key={node.id}
                  style={{
                    position: "relative",
                    borderRadius: "8px",
                    overflow: "hidden",
                    border: "1px solid #E1E3E5",
                    backgroundColor: "#F6F6F7",
                  }}
                >
                  <img
                    src={node.image.url}
                    alt={node.image.altText || node.alt || "Product image"}
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />

                  {/* Badge for published images */}
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "8px",
                    }}
                  >
                    <Badge tone="success" size="small">Published</Badge>
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                    }}
                  >
                    <Button
                      icon={DeleteIcon}
                      variant="primary"
                      tone="critical"
                      size="micro"
                      onClick={() => handleDeleteClick(node.id)}
                      disabled={isDeleting}
                      accessibilityLabel="Delete image"
                    />
                  </div>
                </div>
              );
            })}

            {/* Library images (unpublished) */}
            {filteredLibraryItems.map((item) => {
              const url = typeof item === "string" ? item : item.imageUrl;
              const variantNames = getVariantNames(item);

              return (
                <div
                  key={url}
                  style={{
                    position: "relative",
                    borderRadius: "8px",
                    overflow: "hidden",
                    border: "1px solid #E1E3E5",
                    backgroundColor: "#F6F6F7",
                  }}
                >
                  <img
                    src={url}
                    alt="Stored library variant"
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />

                  {/* Badge for library images */}
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "8px",
                    }}
                  >
                    <Badge>Library</Badge>
                  </div>

                  {/* Variant badges */}
                  {variantNames.length > 0 && variantNames[0] !== "All Variants" && (
                    <div
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                      }}
                    >
                      <Badge tone="info" size="small">
                        {variantNames.length} variant{variantNames.length > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  )}

                  {/* Action buttons overlay for library images */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "8px",
                      right: "8px",
                    }}
                  >
                    <InlineStack gap="100">
                      {onPublishFromLibrary && (
                        <Button
                          size="micro"
                          variant="primary"
                          onClick={() => onPublishFromLibrary(url)}
                        >
                          Publish
                        </Button>
                      )}
                      {onRemoveFromLibrary && (
                        <Button
                          size="micro"
                          tone="critical"
                          variant="plain"
                          onClick={() => handleLibraryDeleteClick(url)}
                        >
                          Remove
                        </Button>
                      )}
                    </InlineStack>
                  </div>
                </div>
              );
            })}
          </InlineGrid>
        </BlockStack>
      </Card>

      <Modal
        open={deleteModalOpen}
        onClose={handleCancelDelete}
        title="Delete product image?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleConfirmDelete,
          loading: isDeleting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCancelDelete,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This will permanently remove the image from your product. This
              action cannot be undone.
            </Text>
            <Text as="p" tone="subdued">
              Note: This won't delete the image from your library or generated
              images. It only removes it from the product.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Library delete confirmation modal */}
      {libraryToDelete && (
        <Modal
          open={!!libraryToDelete}
          onClose={() => setLibraryToDelete(null)}
          title="Remove from library?"
          primaryAction={{
            content: "Remove",
            destructive: true,
            onAction: handleConfirmLibraryDelete,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setLibraryToDelete(null),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p">
                This will permanently remove the image from your library.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </>
  );
}
