import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
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
} from "@shopify/polaris";
import { QuestionCircleIcon } from "@shopify/polaris-icons";

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
}

interface ABTestCreationFormProps {
  productId: string;
  productTitle: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ABTestCreationForm({
  productId,
  productTitle,
  onSuccess,
  onCancel,
}: ABTestCreationFormProps) {
  const fetcher = useFetcher();

  const [selectedGalleryImages, setSelectedGalleryImages] = useState<
    ProductImage[]
  >([]);
  const [variantHeroSelections, setVariantHeroSelections] = useState<
    Map<string, ProductImage>
  >(new Map());
  const [name, setName] = useState("");
  const [loadingData, setLoadingData] = useState(true);
  const [baseCaseTooltipActive, setBaseCaseTooltipActive] = useState(false);

  // Data
  const [baseGalleryImages, setBaseGalleryImages] = useState<ProductImage[]>(
    [],
  );
  const [allAvailableImages, setAllAvailableImages] = useState<ProductImage[]>(
    [],
  );
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);

  // Fetch all product data on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true);
      try {
        // Fetch product images
        const response = await fetch(
          `/app/api/products/${encodeURIComponent(productId)}`,
        );
        const productImagesData = response.ok
          ? (await response.json()).images || []
          : [];
        setBaseGalleryImages(productImagesData);

        // Fetch library images
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
          }),
        );

        // Combine all images
        setAllAvailableImages([...productImagesData, ...libraryImagesData]);

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
    const data = fetcher.data as
      | { success?: boolean; error?: string }
      | undefined;
    if (data?.success && onSuccess) {
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

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
      formData.set(
        "testImages",
        JSON.stringify(
          selectedGalleryImages.map((img, idx) => ({
            url: img.url,
            position: idx,
          })),
        ),
      );
    }

    if (variantHeroSelections.size > 0) {
      const variantTests = Array.from(variantHeroSelections.entries()).map(
        ([variantId, image]) => {
          const variant = productVariants.find((v) => v.id === variantId);
          return {
            variantId,
            variantName: variant?.displayName || variantId,
            heroImage: { url: image.url },
          };
        },
      );
      formData.set("variantTests", JSON.stringify(variantTests));
    }

    fetcher.submit(formData, { method: "post" });
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
      <InlineGrid columns={2} gap="400">
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
                <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="300">
                  {allAvailableImages.map((image) => {
                    const isSelected = selectedGalleryImages.some(
                      (img) => img.id === image.id || img.url === image.url,
                    );
                    return (
                      <div
                        key={image.id}
                        onClick={() => toggleGalleryImage(image)}
                        style={{
                          cursor: "pointer",
                          position: "relative",
                          borderRadius: "12px",
                          overflow: "hidden",
                          border: isSelected
                            ? "3px solid #008060"
                            : "2px solid #E1E3E5",
                          transition: "all 0.2s ease",
                          boxShadow: isSelected
                            ? "0 4px 12px rgba(0, 128, 96, 0.3)"
                            : "none",
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
                        {isSelected && (
                          <div
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              background: "#008060",
                              color: "white",
                              borderRadius: "50%",
                              width: "32px",
                              height: "32px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: "bold",
                              fontSize: "18px",
                              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                            }}
                          >
                            ✓
                          </div>
                        )}
                        {image.altText?.includes("AI Generated") && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: "8px",
                              left: "8px",
                              background: "rgba(0, 0, 0, 0.7)",
                              color: "white",
                              borderRadius: "4px",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: "500",
                            }}
                          >
                            🎨 AI
                          </div>
                        )}
                      </div>
                    );
                  })}
                </InlineGrid>
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
          </BlockStack>
        </Card>
      </InlineGrid>

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
                            <InlineGrid columns={4} gap="200">
                              {allAvailableImages.map((image) => {
                                const isSelected =
                                  selectedHero?.url === image.url;
                                return (
                                  <div
                                    key={`${variant.id}-${image.id}`}
                                    onClick={() =>
                                      selectVariantHero(variant.id, image)
                                    }
                                    style={{
                                      cursor: "pointer",
                                      position: "relative",
                                      borderRadius: "8px",
                                      overflow: "hidden",
                                      border: isSelected
                                        ? "3px solid #008060"
                                        : "2px solid #E1E3E5",
                                      transition: "all 0.2s ease",
                                      boxShadow: isSelected
                                        ? "0 4px 12px rgba(0, 128, 96, 0.3)"
                                        : "none",
                                      aspectRatio: "1 / 1",
                                    }}
                                  >
                                    <img
                                      src={image.url}
                                      alt=""
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block",
                                      }}
                                    />
                                    {isSelected && (
                                      <div
                                        style={{
                                          position: "absolute",
                                          top: "4px",
                                          right: "4px",
                                          background: "#008060",
                                          color: "white",
                                          borderRadius: "50%",
                                          width: "24px",
                                          height: "24px",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "14px",
                                          fontWeight: "bold",
                                          boxShadow:
                                            "0 2px 6px rgba(0, 0, 0, 0.2)",
                                        }}
                                      >
                                        ✓
                                      </div>
                                    )}
                                    {image.altText?.includes("AI") && (
                                      <div
                                        style={{
                                          position: "absolute",
                                          bottom: "4px",
                                          left: "4px",
                                          background: "rgba(0, 0, 0, 0.75)",
                                          color: "white",
                                          borderRadius: "4px",
                                          padding: "2px 6px",
                                          fontSize: "10px",
                                          fontWeight: "600",
                                        }}
                                      >
                                        AI
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </InlineGrid>
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
