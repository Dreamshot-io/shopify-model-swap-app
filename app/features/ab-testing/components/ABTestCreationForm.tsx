import { useState, useCallback, useEffect } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import {
  BlockStack,
  TextField,
  Button,
  Banner,
  Text,
  InlineStack,
  Spinner,
  Divider,
  InlineGrid,
  Card,
  Popover,
  Icon,
  Modal,
} from "@shopify/polaris";
import { QuestionCircleIcon, ImageAddIcon } from "@shopify/polaris-icons";
import { SortableGalleryGrid } from "../../ai-studio/components/SortableGalleryGrid";
import { useGalleryReorder } from "../../ai-studio/hooks/useGalleryReorder";

interface ProductVariant {
  id: string;
  displayName: string;
  image?: {
    url: string;
    altText?: string;
  };
}

interface ProductImage {
  id: string;
  url: string;
  altText?: string;
  position?: number;
  originalSource?: string;
}

interface ABTestCreationFormProps {
  productId: string;
  productTitle: string;
  shop: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ABTestCreationForm({
  productId,
  productTitle,
  shop,
  onSuccess,
  onCancel,
}: ABTestCreationFormProps) {
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [selectedGalleryImages, setSelectedGalleryImages] = useState<
    ProductImage[]
  >([]);
  const [variantHeroSelections, setVariantHeroSelections] = useState<
    Map<string, ProductImage>
  >(new Map());
  const [name, setName] = useState("");
  const [loadingData, setLoadingData] = useState(true);
  const [baseCaseTooltipActive, setBaseCaseTooltipActive] = useState(false);
  const [showAddImagesModal, setShowAddImagesModal] = useState(false);

  // Data - images with position tracking
  const [baseGalleryImages, setBaseGalleryImages] = useState<ProductImage[]>(
    [],
  );
  const [allAvailableImages, setAllAvailableImages] = useState<ProductImage[]>(
    [],
  );
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);

  // Track unified gallery order
  const [galleryOrder, setGalleryOrder] = useState<string[]>([]);

  // Centralized function to handle reordering across all galleries
  const handleGalleryReorder = useCallback((reorderedImages: ProductImage[]) => {
    // Update all available images with new positions
    setAllAvailableImages(reorderedImages);

    // Update gallery order
    const newOrder = reorderedImages.map(img => img.id);
    setGalleryOrder(newOrder);

    // Update selected gallery images to maintain their new order
    const selectedIds = new Set(selectedGalleryImages.map(img => img.id));
    const reorderedSelected = reorderedImages
      .filter(img => selectedIds.has(img.id))
      .map((img, idx) => ({ ...img, position: idx }));
    setSelectedGalleryImages(reorderedSelected);

    // Update variant hero selections to maintain consistency
    const newHeroSelections = new Map<string, ProductImage>();
    variantHeroSelections.forEach((image, variantId) => {
      const reorderedImage = reorderedImages.find(img => img.id === image.id);
      if (reorderedImage) {
        newHeroSelections.set(variantId, reorderedImage);
      }
    });
    setVariantHeroSelections(newHeroSelections);
  }, [selectedGalleryImages, variantHeroSelections]);

  // Fetch all product data on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true);
      try {
        // Fetch product images with positions
        const response = await fetch(
          `/app/api/products/${encodeURIComponent(productId)}`,
        );
        const productImagesData = response.ok
          ? ((await response.json()).images || []).map((img: any, idx: number) => ({
              ...img,
              position: img.position ?? idx,
            }))
          : [];
        setBaseGalleryImages(productImagesData);

        // Fetch library images with positions
        const libraryResponse = await fetch(
          `/app/api/products/${encodeURIComponent(productId)}/library`,
        );
        const libraryData = libraryResponse.ok
          ? await libraryResponse.json()
          : { libraryItems: [] };
        const libraryImagesData = (libraryData.libraryItems || []).map(
          (item: any, idx: number) => ({
            id: `lib-${idx}`,
            url: item.imageUrl || item,
            altText: "🎨 AI Generated",
            position: productImagesData.length + idx, // Position after product images
          }),
        );

        // Combine all images with positions
        const combinedImages = [...productImagesData, ...libraryImagesData];
        setAllAvailableImages(combinedImages);

        // Initialize gallery order from positions
        const initialOrder = combinedImages
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map(img => img.id);
        setGalleryOrder(initialOrder);

        // Fetch variants
        const variantsResponse = await fetch(
          `/app/api/products/${encodeURIComponent(productId)}/variants`,
        );
        if (variantsResponse.ok) {
          const variantsData = await variantsResponse.json();
          setProductVariants(variantsData.variants || []);
        }
      } catch (error) {
        console.error("Failed to fetch product data:", error);
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [productId]);

  // Handle success response
  useEffect(() => {
    console.log('[ABTestCreationForm] Fetcher state changed:', {
      state: fetcher.state,
      data: fetcher.data,
    });
    
    const data = fetcher.data as
      | { success?: boolean; error?: string }
      | undefined;
    if (data?.success && onSuccess) {
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const toggleGalleryImage = useCallback((image: ProductImage) => {
    setSelectedGalleryImages((prev) => {
      const exists = prev.find(
        (img) => img.id === image.id || img.url === image.url,
      );
      if (exists) {
        return prev.filter(
          (img) => img.id !== image.id && img.url !== image.url,
        );
      }
      return [...prev, image];
    });
  }, []);

  const selectVariantHero = useCallback(
    (variantId: string, image: ProductImage) => {
      setVariantHeroSelections((prev) => {
        const newMap = new Map(prev);
        const currentSelection = newMap.get(variantId);

        // If clicking the same image that's already selected, deselect it
        if (currentSelection?.url === image.url) {
          newMap.delete(variantId);
        } else {
          // Otherwise, select the new image
          newMap.set(variantId, image);
        }

        return newMap;
      });
    },
    [],
  );

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("name", name);
    formData.set("productId", productId);

    if (selectedGalleryImages.length > 0) {
      // Filter out any images without valid URLs
      const validGalleryImages = selectedGalleryImages.filter(
        (img) => img && img.url && typeof img.url === 'string',
      );

      if (validGalleryImages.length > 0) {
        formData.set(
          "testImages",
          JSON.stringify(
            validGalleryImages.map((img, idx) => ({
              url: img.url,
              position: idx,
            })),
          ),
        );
      }
    }

    if (variantHeroSelections.size > 0) {
      const variantTests = Array.from(variantHeroSelections.entries())
        .filter(([variantId, image]) => {
          // Filter out any selections where image or image.url is missing
          if (!image || !image.url || typeof image.url !== 'string') {
            console.warn(`Skipping variant ${variantId}: missing or invalid hero image URL`);
            return false;
          }
          return true;
        })
        .map(([variantId, image]) => {
          const variant = productVariants.find((v) => v.id === variantId);
          return {
            variantId,
            variantName: variant?.displayName || variantId,
            heroImage: { url: image.url },
          };
        });

      // Only set variantTests if we have valid entries after filtering
      if (variantTests.length > 0) {
        formData.set("variantTests", JSON.stringify(variantTests));
      }
    }

    // Validate that we have at least one valid selection before submitting
    const hasTestImages = formData.has("testImages");
    const hasVariantTests = formData.has("variantTests");

    console.log('[ABTestCreationForm] Submitting:', {
      name: formData.get('name'),
      productId: formData.get('productId'),
      hasTestImages,
      hasVariantTests,
      shop,
    });

    if (!hasTestImages && !hasVariantTests) {
      // This shouldn't happen if form validation is working, but add safety check
      console.error("Cannot submit test: no valid images or variant heroes selected");
      return;
    }

    console.log('[ABTestCreationForm] Calling fetcher.submit with POST to:', `/app/ab-tests?productId=${encodeURIComponent(productId)}&shop=${encodeURIComponent(shop)}`);
    
    fetcher.submit(formData, { 
      method: "post",
      action: `/app/ab-tests?productId=${encodeURIComponent(productId)}&shop=${encodeURIComponent(shop)}`,
    });
  };

  const isFormValid = () => {
    if (!name) return false;
    return selectedGalleryImages.length > 0 || variantHeroSelections.size > 0;
  };

  if (loadingData) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <Spinner size="large" />
        <br />
        <Text as="p" tone="subdued">
          Loading product data...
        </Text>
      </div>
    );
  }

  const fetcherData = fetcher.data as
    | { success?: boolean; error?: string }
    | undefined;

  return (
    <BlockStack gap="500">
      {fetcherData?.error && (
        <Banner tone="critical" title="Error">
          <Text as="p">{fetcherData.error}</Text>
        </Banner>
      )}

      <TextField
        label="Test Name"
        value={name}
        onChange={setName}
        autoComplete="off"
        placeholder={`${productTitle} Test - ${new Date().toLocaleDateString()}`}
        requiredIndicator
        error={
          !name &&
          (selectedGalleryImages.length > 0 || variantHeroSelections.size > 0)
            ? "Test name is required to create the test"
            : undefined
        }
      />

      {/* Product Gallery Test Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'stretch' }}>
        {/* Left: Base Case */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" align="start">
              <Text variant="headingMd" as="h2">
                Base Case
              </Text>
              <Popover
                active={baseCaseTooltipActive}
                activator={
                  <button
                    type="button"
                    onClick={() =>
                      setBaseCaseTooltipActive(!baseCaseTooltipActive)
                    }
                    style={{
                      cursor: "help",
                      display: "inline-flex",
                      alignItems: "center",
                      background: "none",
                      border: "none",
                      padding: "4px",
                      margin: 0,
                    }}
                  >
                    <Icon source={QuestionCircleIcon} tone="subdued" />
                  </button>
                }
                onClose={() => setBaseCaseTooltipActive(false)}
              >
                <div style={{ padding: "16px", maxWidth: "250px" }}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      The base case cannot be changed because it represents the
                      current product gallery used for comparison against your
                      test images.
                    </Text>
                  </BlockStack>
                </div>
              </Popover>
            </InlineStack>
            <Text as="p" tone="subdued">
              Current product gallery
            </Text>
            {baseGalleryImages.length === 0 ? (
              <Banner tone="info">
                <Text as="p">No images in product</Text>
              </Banner>
            ) : (
              <div style={{ opacity: 0.6, filter: "grayscale(20%)" }}>
                <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="300">
                  {baseGalleryImages.map((image) => (
                    <div
                      key={image.id}
                      style={{
                        borderRadius: "12px",
                        overflow: "hidden",
                        border: "2px solid #E1E3E5",
                        aspectRatio: "1 / 1",
                      }}
                    >
                      <img
                        src={image.url}
                        alt={image.altText || ""}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </div>
                  ))}
                </InlineGrid>
              </div>
            )}
          </BlockStack>
        </Card>

        {/* Right: Test Case */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Test Case
            </Text>
            <Text as="p" tone="subdued">
              Select images to test
            </Text>
            {allAvailableImages.length === 0 ? (
              <Banner tone="warning">
                <Text as="p">
                  No images available. Add product images or generate in AI
                  Studio.
                </Text>
              </Banner>
            ) : (
              <>
                <SortableGalleryGrid
                  images={allAvailableImages}
                  selectedImageIds={new Set(selectedGalleryImages.map(img => img.id))}
                  onReorder={handleGalleryReorder}
                  onImageSelect={(image) => {
                    toggleGalleryImage(image);
                  }}
                  onImageDeselect={(image) => {
                    toggleGalleryImage(image);
                  }}
                  showSelectionNumbers={false}
                />
                {selectedGalleryImages.length > 0 && (
                  <Banner tone="success">
                    <Text as="p">
                      {selectedGalleryImages.length} image
                      {selectedGalleryImages.length !== 1 ? "s" : ""} selected
                      for test
                    </Text>
                  </Banner>
                )}
                {name &&
                  selectedGalleryImages.length === 0 &&
                  variantHeroSelections.size === 0 && (
                    <Banner tone="warning">
                      <Text as="p">
                        Select at least one gallery image or variant hero to
                        create a test
                      </Text>
                    </Banner>
                  )}
              </>
            )}
            <Button
              icon={ImageAddIcon}
              onClick={() => setShowAddImagesModal(true)}
              fullWidth
            >
              Need more images? Add more images
            </Button>
          </BlockStack>
        </Card>
      </div>

      {/* Add More Images Confirmation Modal */}
      <Modal
        open={showAddImagesModal}
        onClose={() => setShowAddImagesModal(false)}
        title="Leave this page?"
        primaryAction={{
          content: "Add More Images",
          onAction: () => {
            navigate(`/app/products/${encodeURIComponent(productId)}?tab=images`);
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowAddImagesModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            You're about to leave this page. Any unsaved changes to your A/B test will be lost.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Variant Hero Images Section */}
      {productVariants.length > 0 && (
        <>
          <Divider />
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Variant Hero Images
            </Text>
            <Text as="p" tone="subdued">
              Optional: Select hero images for specific variants
            </Text>

            <BlockStack gap="500">
              {productVariants.map((variant) => {
                const selectedHero = variantHeroSelections.get(variant.id);

                return (
                  <Card key={variant.id}>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">
                        {variant.displayName}
                      </Text>

                      <InlineGrid columns={2} gap="400">
                        {/* Left: Current Hero */}
                        <BlockStack gap="300">
                          <Text variant="headingSm" as="h4">
                            Current Hero
                          </Text>
                          {variant.image ? (
                            <div
                              style={{
                                borderRadius: "12px",
                                overflow: "hidden",
                                border: "2px solid #E1E3E5",
                                maxWidth: "200px",
                                aspectRatio: "1 / 1",
                              }}
                            >
                              <img
                                src={variant.image.url}
                                alt={
                                  variant.image.altText || variant.displayName
                                }
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  display: "block",
                                }}
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                borderRadius: "12px",
                                border: "2px dashed #E1E3E5",
                                aspectRatio: "1 / 1",
                                maxWidth: "200px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "#F6F6F7",
                              }}
                            >
                              <Text as="p" tone="subdued">
                                No hero image
                              </Text>
                            </div>
                          )}
                        </BlockStack>

                        {/* Right: Test Hero Selection */}
                        <BlockStack gap="300">
                          <Text variant="headingSm" as="h4">
                            Test Hero
                          </Text>
                          {allAvailableImages.length === 0 ? (
                            <Banner tone="warning">
                              <Text as="p">No images available</Text>
                            </Banner>
                          ) : (
                            <SortableGalleryGrid
                              images={allAvailableImages}
                              selectedImageIds={new Set(
                                selectedHero ? [selectedHero.id] : []
                              )}
                              onReorder={handleGalleryReorder}
                              onImageSelect={(image) => {
                                selectVariantHero(variant.id, image);
                              }}
                              onImageDeselect={(image) => {
                                selectVariantHero(variant.id, image);
                              }}
                              showSelectionNumbers={false}
                              maxSelection={1}
                            />
                          )}
                          {selectedHero && (
                            <Text as="p" tone="success">
                              ✓ Test hero selected
                            </Text>
                          )}
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>

            {variantHeroSelections.size > 0 && (
              <Banner tone="success">
                <Text as="p">
                  {variantHeroSelections.size} of {productVariants.length}{" "}
                  variant{productVariants.length !== 1 ? "s" : ""} configured
                </Text>
              </Banner>
            )}
            {variantHeroSelections.size > 0 &&
              selectedGalleryImages.length === 0 && (
                <Banner tone="info">
                  <Text as="p">
                    Variant heroes selected but no gallery images - test will
                    only affect variant hero images
                  </Text>
                </Banner>
              )}
          </BlockStack>
        </>
      )}

      <Divider />

      <InlineStack align="space-between">
        <div>
          {!isFormValid() && name && (
            <Text as="p" tone="subdued">
              💡 Select at least one image to create a test
            </Text>
          )}
        </div>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!isFormValid()}
          loading={fetcher.state !== "idle"}
        >
          Create Test
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
