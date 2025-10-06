import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher, useNavigate } from "@remix-run/react";
import { Page, Text, Card, BlockStack, Banner, Modal, InlineGrid, InlineStack, TextField, EmptyState } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkAIProviderHealth } from "../services/ai-providers.server";
import { ImagePreviewModal } from "../features/ai-studio/components/ImagePreviewModal";
import { ImageGenerationHub } from "../features/ai-studio/components/ImageGenerationHub";
import { ProductGallery } from "../features/ai-studio/components/ProductGallery";
import { handleGenerate } from "../features/ai-studio/handlers/generation.server";
import {
  handleSaveToLibrary,
  handleDeleteFromLibrary,
  handleUpload,
} from "../features/ai-studio/handlers/library.server";
import {
  handlePublish,
  handleDeleteFromProduct,
} from "../features/ai-studio/handlers/product-media.server";
import type {
  LibraryItem,
  GeneratedImage,
  SelectedImage,
  BatchProcessingState,
  GenerateImageResponse,
  PublishImageResponse,
  LibraryActionResponse,
  ActionErrorResponse,
} from "../features/ai-studio/types";
import { ABTestManager } from "../features/ab-testing/components/ABTestManager";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    // Fetch products for selection
    const productsResponse = await admin.graphql(
      `#graphql
      query GetProducts($first: Int!) {
        products(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              status
              featuredImage {
                url
                altText
              }
            }
          }
        }
      }`,
      {
        variables: { first: 50 },
      },
    );

    const productsJson = await productsResponse.json();
    const products = productsJson.data?.products?.edges?.map((edge: any) => edge.node) || [];

    return { product: null, abTests: [], activeTest: null, products };
  }

  // Fetch product data
  const response = await admin.graphql(
    `#graphql
    query GetProductWithMedia($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        handle
        status
        metafield(namespace: "dreamshot", key: "ai_library") { value }
        media(first: 20) {
          nodes {
            id
            alt
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }`,
    {
      variables: { id: productId },
    },
  );

  const responseJson = await response.json();

  // Fetch A/B tests for this product
  const abTests = await db.aBTest.findMany({
    where: {
      shop: session.shop,
      productId: productId,
    },
    include: {
      variants: true,
      events: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Find active test (RUNNING or DRAFT)
  const activeTest =
    abTests.find(
      (test) => test.status === "RUNNING" || test.status === "DRAFT",
    ) || null;

  return {
    product: responseJson.data?.product || null,
    abTests,
    activeTest,
    products: [],
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<Response> => {
  try {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "generate");
    const productId = String(formData.get("productId") || "");
    const { admin, session } = await authenticate.admin(request);

    // Route to appropriate handler based on intent
    switch (intent) {
      case "publish":
        return handlePublish(formData, admin, session.shop);

      case "deleteFromProduct":
        return handleDeleteFromProduct(formData, admin, session.shop);

      case "saveToLibrary":
        return handleSaveToLibrary(formData, admin, session.shop);

      case "deleteFromLibrary":
        return handleDeleteFromLibrary(formData, admin, session.shop);

      case "upload":
        return handleUpload(formData, admin, session.shop);

      case "createABTest": {
        const name = String(formData.get("name") || "");
        const variantAImages = String(formData.get("variantAImages") || "");
        const variantBImages = String(formData.get("variantBImages") || "");
        const trafficSplit = parseInt(
          String(formData.get("trafficSplit") || "50"),
        );

        if (!name || !productId || !variantAImages || !variantBImages) {
          return json(
            { ok: false, error: "Missing required fields" },
            { status: 400 },
          );
        }

        const test = await db.aBTest.create({
          data: {
            shop: session.shop,
            productId,
            name,
            status: "DRAFT",
            trafficSplit,
            variants: {
              create: [
                { variant: "A", imageUrls: variantAImages },
                { variant: "B", imageUrls: variantBImages },
              ],
            },
          },
          include: { variants: true },
        });

        return json({ ok: true, test });
      }

      case "startABTest":
      case "stopABTest":
      case "deleteABTest": {
        const testId = String(formData.get("testId") || "");
        if (!testId) {
          return json(
            { ok: false, error: "Missing test ID" },
            { status: 400 },
          );
        }

        if (intent === "startABTest") {
          const updatedTest = await db.aBTest.update({
            where: { id: testId },
            data: { status: "RUNNING", startDate: new Date() },
          });
          return json({ ok: true, test: updatedTest });
        } else if (intent === "stopABTest") {
          const updatedTest = await db.aBTest.update({
            where: { id: testId },
            data: { status: "COMPLETED", endDate: new Date() },
          });
          return json({ ok: true, test: updatedTest });
        } else {
          await db.aBTest.delete({ where: { id: testId } });
          return json({ ok: true });
        }
      }

      case "generate":
      default: {
        const healthCheck = checkAIProviderHealth();
        if (!healthCheck.healthy) {
          const errorResponse: ActionErrorResponse = {
            ok: false,
            error: `AI service unavailable: ${healthCheck.error}`,
          };
          return json(errorResponse, { status: 503 });
        }

        return handleGenerate(formData, session.shop);
      }
    }
  } catch (globalError: any) {
    console.error("[action] Unexpected error:", globalError);

    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "An unexpected error occurred. Please try again.",
      debug:
        process.env.NODE_ENV === "development"
          ? {
              message: globalError.message,
              stack: globalError.stack,
            }
          : undefined,
    };
    return json(errorResponse, { status: 500 });
  }
};

export default function AIStudio() {
  const { product, abTests, activeTest, products } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [searchQuery, setSearchQuery] = useState("");

  // State management
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [batchProcessingState, setBatchProcessingState] =
    useState<BatchProcessingState>({
      isProcessing: false,
      currentIndex: 0,
      totalImages: 0,
      completedImages: [],
      failedImages: [],
    });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewBase, setPreviewBase] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [pendingAction, setPendingAction] = useState<
    null | "generate" | "publish" | "saveToLibrary" | "deleteFromLibrary"
  >(null);
  const [libraryItemToDelete, setLibraryItemToDelete] = useState<string | null>(
    null,
  );

  // const productId = searchParams.get("productId");
  const selectedImageFromUrl = searchParams.get("selectedImage");

  // AI providers are initialized server-side only
  // No client-side initialization needed

  useEffect(() => {
    if (selectedImageFromUrl && product?.media?.nodes) {
      const matchingNode = product.media.nodes.find(
        (node: any) => node.image?.url === selectedImageFromUrl,
      );
      if (matchingNode) {
        setSelectedImages([
          {
            id: matchingNode.id,
            url: selectedImageFromUrl,
            altText: matchingNode.image?.altText,
          },
        ]);
      }
    }
  }, [selectedImageFromUrl, product]);

  useEffect(() => {
    try {
      const raw = (product as any)?.metafield?.value;
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const normalized = arr.map((item: any) =>
          typeof item === "string" ? { imageUrl: item } : item,
        );
        setLibraryItems(normalized);
      }
    } catch {}
  }, [product]);

  // Handle image selection
  const handleImageSelect = (image: SelectedImage) => {
    setSelectedImages((prev) => {
      const isAlreadySelected = prev.some((img) => img.url === image.url);
      if (isAlreadySelected) {
        // Remove from selection
        return prev.filter((img) => img.url !== image.url);
      } else {
        // Add to selection
        return [...prev, image];
      }
    });
  };

  const handleClearSelection = () => {
    setSelectedImages([]);
  };

  // Handle batch model swap generation
  const handleGenerate = async (prompt: string) => {
    if (selectedImages.length === 0 || !prompt.trim()) {
      shopify.toast.show(
        "Please select at least one image and enter a model description",
        { isError: true },
      );
      return;
    }

    // Initialize batch processing state
    setBatchProcessingState({
      isProcessing: true,
      currentIndex: 0,
      totalImages: selectedImages.length,
      completedImages: [],
      failedImages: [],
    });

    // Set pending action to indicate batch generation is in progress
    setPendingAction("generate");

    // Process images sequentially
    for (let i = 0; i < selectedImages.length; i++) {
      const image = selectedImages[i];

      // Update current processing index
      setBatchProcessingState((prev) => ({
        ...prev,
        currentIndex: i,
      }));

      try {
        const fd = new FormData();
        fd.set("sourceImageUrl", image.url);
        fd.set("prompt", prompt);
        fd.set("productId", product?.id || "");
        fd.set("intent", "generate");

        // Wait for the generation to complete
        const response = await fetch(window.location.pathname, {
          method: "POST",
          body: fd,
        });

        const result = await response.json();

        if (result.ok && result.result) {
          // Add successful result - ensure proper structure
          const generatedImage: GeneratedImage = {
            id: result.result.id || `batch_${Date.now()}_${i}`,
            imageUrl: result.result.imageUrl,
            confidence: result.result.confidence || 0.9,
            metadata: {
              ...result.result.metadata,
              sourceImage: image,
              prompt,
              batchIndex: i + 1,
              batchTotal: selectedImages.length,
              generatedAt: new Date().toISOString(),
            },
          };

          setBatchProcessingState((prev) => ({
            ...prev,
            completedImages: [...prev.completedImages, generatedImage],
          }));

          setGeneratedImages((prev) => [...prev, generatedImage]);
        } else {
          // Add failed result
          setBatchProcessingState((prev) => ({
            ...prev,
            failedImages: [
              ...prev.failedImages,
              {
                imageUrl: image.url,
                error: result.error || "Unknown error",
              },
            ],
          }));
        }
      } catch (error) {
        console.error(`❌ Model swap failed for image ${i + 1}:`, error);
        setBatchProcessingState((prev) => ({
          ...prev,
          failedImages: [
            ...prev.failedImages,
            {
              imageUrl: image.url,
              error: error instanceof Error ? error.message : "Network error",
            },
          ],
        }));
      }
    }

    // Complete batch processing and show completion toast
    setBatchProcessingState((prev) => {
      const completedCount = prev.completedImages.length;
      const failedCount = prev.failedImages.length;

      // Show completion toast
      if (failedCount === 0) {
        shopify.toast.show(
          `Successfully generated ${completedCount} AI images! 🎉`,
        );
      } else if (completedCount > 0) {
        shopify.toast.show(
          `Generated ${completedCount} images successfully, ${failedCount} failed`,
          { isError: false },
        );
      } else {
        shopify.toast.show(`Failed to generate images. Please try again.`, {
          isError: true,
        });
      }

      return {
        ...prev,
        isProcessing: false,
      };
    });

    // Reset pending action after batch completion
    setPendingAction(null);
  };

  useEffect(() => {
    const data = fetcher.data as
      | ({ ok: true; result: any } & any)
      | ({ ok: true; published: true } & any)
      | ({ ok: true; savedToLibrary: true } & any)
      | { ok: false; error: string }
      | undefined;

    // Handle single image generation (legacy mode - not batch processing)
    if (
      data?.ok &&
      pendingAction === "generate" &&
      (data as any).result &&
      !batchProcessingState.isProcessing
    ) {
      const result = (data as any).result;
      // Ensure the generated image has a proper structure
      const generatedImage: GeneratedImage = {
        id: result.id || `generated_${Date.now()}`,
        imageUrl: result.imageUrl,
        confidence: result.confidence || 0.9,
        metadata: {
          ...result.metadata,
          sourceImage: selectedImages.length > 0 ? selectedImages[0] : null,
          generatedAt: new Date().toISOString(),
        },
      };
      setGeneratedImages((prev) => [...prev, generatedImage]);
      shopify.toast.show("AI image generated successfully! 🎉");
      setPendingAction(null);
    } else if (data?.ok && pendingAction === "publish") {
      shopify.toast.show("Published to product");
      setPendingAction(null);
    } else if (data?.ok && pendingAction === "saveToLibrary") {
      if ((data as any).duplicate) {
        shopify.toast.show("Item already in library", { isError: false });
      } else if ((data as any).savedToLibrary) {
        shopify.toast.show("Saved to library");
      }
      const img =
        (fetcher.formData?.get &&
          (fetcher.formData.get("imageUrl") as string)) ||
        null;
      if (img) {
        const sourceUrl =
          (fetcher.formData?.get &&
            (fetcher.formData.get("sourceUrl") as string)) ||
          (selectedImages.length > 0 ? selectedImages[0].url : null);
        setLibraryItems((prev) => [{ imageUrl: img, sourceUrl }, ...prev]);
      }
      setPendingAction(null);
    } else if (data?.ok && pendingAction === "deleteFromLibrary") {
      const img =
        (fetcher.formData?.get &&
          (fetcher.formData.get("imageUrl") as string)) ||
        null;
      if (img) {
        setLibraryItems((prev) =>
          prev.filter((item) =>
            typeof item === "string" ? item !== img : item.imageUrl !== img,
          ),
        );
      }
      shopify.toast.show("Removed from library");
      setLibraryItemToDelete(null);
      setPendingAction(null);
    } else if (data && !data.ok) {
      shopify.toast.show(String(data.error), { isError: true });
      setPendingAction(null);
    }

    // Handle A/B test responses
    const intent = fetcher.formData?.get?.("intent") as string;
    if (data?.ok && intent === "createABTest") {
      shopify.toast.show("A/B test created successfully! 🎉");
      window.location.reload(); // Refresh to show new test
    } else if (data?.ok && intent === "startABTest") {
      shopify.toast.show("A/B test started successfully");
      window.location.reload();
    } else if (data?.ok && intent === "stopABTest") {
      shopify.toast.show("A/B test stopped successfully");
      window.location.reload();
    } else if (data?.ok && intent === "deleteABTest") {
      shopify.toast.show("A/B test deleted successfully");
      window.location.reload();
    }
  }, [fetcher.data, pendingAction, shopify, batchProcessingState.isProcessing, fetcher.formData]);

  const handlePublishImage = async (image: any) => {
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("imageUrl", image.imageUrl);
    fd.set("productId", product?.id || "");
    setPendingAction("publish");
    fetcher.submit(fd, { method: "post" });
  };

  const handlePublishFromLibrary = (url: string) => {
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("imageUrl", url);
    fd.set("productId", product?.id || "");
    setPendingAction("publish");
    fetcher.submit(fd, { method: "post" });
  };

  const handleABTestCreate = (request: any) => {
    const fd = new FormData();
    fd.set("intent", "createABTest");
    fd.set("name", request.name);
    fd.set("productId", request.productId);
    fd.set("variantAImages", JSON.stringify(request.variantAImages));
    fd.set("variantBImages", JSON.stringify(request.variantBImages));
    fd.set("trafficSplit", String(request.trafficSplit || 50));

    fetcher.submit(fd, { method: "post" });
  };

  const handleABTestAction = (
    testId: string,
    action: "start" | "stop" | "delete",
  ) => {
    const fd = new FormData();
    fd.set("intent", `${action}ABTest`);
    fd.set("testId", testId);

    fetcher.submit(fd, { method: "post" });
  };

  // Get all available images (original + generated + library)
  const getAllImages = () => {
    const originalImages =
      product?.media?.nodes
        ?.map((node: any) => node.image?.url)
        .filter(Boolean) || [];

    const generatedImageUrls = generatedImages.map((img) => img.imageUrl);

    const libraryImageUrls = libraryItems.map((item) =>
      typeof item === "string" ? item : item.imageUrl,
    );

    // Note: libraryImageUrls are now also selectable as source images via ImageSelector
    return [...originalImages, ...generatedImageUrls, ...libraryImageUrls];
  };

  if (!product) {
    // Filter products based on search query
    const filteredProducts = products?.filter((p: any) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    return (
      <Page>
        <TitleBar title="AI Image Studio" />
        <BlockStack gap="500">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Select a Product
              </Text>
              <Text as="p" tone="subdued">
                Choose a product to start generating AI images
              </Text>
              <TextField
                label=""
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
              />
            </BlockStack>
          </Card>

          {filteredProducts.length === 0 ? (
            <Card>
              <EmptyState
                heading="No products found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {searchQuery
                    ? "Try adjusting your search to find products"
                    : "Create products in your store to use AI Studio"}
                </p>
              </EmptyState>
            </Card>
          ) : (
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
              {filteredProducts.map((product: any) => (
                <Card key={product.id}>
                  <BlockStack gap="300">
                    {product.featuredImage?.url ? (
                      <div
                        onClick={() =>
                          navigate(
                            `/app/ai-studio?productId=${encodeURIComponent(
                              product.id
                            )}`
                          )
                        }
                        style={{
                          cursor: "pointer",
                          borderRadius: "8px",
                          overflow: "hidden",
                          aspectRatio: "1",
                          backgroundColor: "#F6F6F7",
                        }}
                      >
                        <img
                          src={product.featuredImage.url}
                          alt={product.featuredImage.altText || product.title}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        onClick={() =>
                          navigate(
                            `/app/ai-studio?productId=${encodeURIComponent(
                              product.id
                            )}`
                          )
                        }
                        style={{
                          cursor: "pointer",
                          borderRadius: "8px",
                          aspectRatio: "1",
                          backgroundColor: "#F6F6F7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text as="p" tone="subdued">
                          No image
                        </Text>
                      </div>
                    )}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd" truncate>
                        {product.title}
                      </Text>
                      <InlineStack align="space-between">
                        <Text as="p" tone="subdued">
                          {product.status}
                        </Text>
                        <button
                          onClick={() =>
                            navigate(
                              `/app/ai-studio?productId=${encodeURIComponent(
                                product.id
                              )}`
                            )
                          }
                          style={{
                            background: "#008060",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "8px 16px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: "500",
                          }}
                        >
                          Select
                        </button>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          )}
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title={`AI Studio - ${product.title}`}>
        <button
          onClick={() => {
            // Navigate back to product
            const productNumericId = product.id.replace(
              "gid://shopify/Product/",
              "",
            );
            window.open(`shopify:admin/products/${productNumericId}`, "_blank");
          }}
        >
          View Product
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {previewImage && (
          <ImagePreviewModal
            url={previewImage}
            baseUrl={previewBase}
            onClose={() => setPreviewImage(null)}
          />
        )}

        {/* Delete confirmation modal for library items */}
        {libraryItemToDelete && (
          <Modal
            open
            onClose={() => setLibraryItemToDelete(null)}
            title="Remove from library?"
            primaryAction={{
              content: "Delete",
              destructive: true,
              onAction: () => {
                const fd = new FormData();
                fd.set("intent", "deleteFromLibrary");
                fd.set("imageUrl", libraryItemToDelete);
                fd.set("productId", product?.id || "");
                setPendingAction("deleteFromLibrary");
                fetcher.submit(fd, { method: "post" });
              },
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setLibraryItemToDelete(null),
              },
            ]}
          >
            <BlockStack gap="200">
              <Text as="p">
                This will permanently remove the image from your library.
              </Text>
            </BlockStack>
          </Modal>
        )}

        {/* AREA 1: A/B Test Results - Unchanged */}
        <ABTestManager
          productId={product?.id || ""}
          availableImages={getAllImages()}
          existingTests={abTests || []}
          activeTest={activeTest}
          onTestCreate={handleABTestCreate}
          onTestAction={handleABTestAction}
          isCreating={false}
        />

        {/* AREA 2: Product Gallery - Shows both published and library images */}
        <ProductGallery
          images={product.media?.nodes || []}
          libraryItems={libraryItems}
          onDelete={(mediaId) => {
            const fd = new FormData();
            fd.set("intent", "deleteFromProduct");
            fd.set("mediaId", mediaId);
            fd.set("productId", product?.id || "");
            setPendingAction("deleteFromProduct");
            fetcher.submit(fd, { method: "post" });
          }}
          onPublishFromLibrary={(url) => handlePublishFromLibrary(url)}
          onRemoveFromLibrary={(url) => {
            setLibraryItemToDelete(url);
          }}
          isDeleting={pendingAction === "deleteFromProduct"}
        />

        {/* AREA 3: Image Generation Hub - New */}
        <ImageGenerationHub
          media={product.media?.nodes || []}
          selectedImages={selectedImages}
          generatedImages={generatedImages}
          libraryItems={libraryItems}
          batchProcessingState={batchProcessingState}
          onImageSelect={handleImageSelect}
          onClearSelection={handleClearSelection}
          onGenerate={handleGenerate}
          onPublish={(img) => handlePublishImage(img)}
          onSaveToLibrary={(img) => {
            const fd = new FormData();
            fd.set("intent", "saveToLibrary");
            fd.set("imageUrl", img.imageUrl);
            const sourceUrl =
              img.metadata?.sourceImage?.url ||
              (selectedImages.length > 0 ? selectedImages[0].url : "");
            fd.set("sourceUrl", sourceUrl);
            fd.set("productId", product?.id || "");
            setPendingAction("saveToLibrary");
            fetcher.submit(fd, { method: "post" });
          }}
          onPreview={(img) => {
            setPreviewImage(img.imageUrl);
            const baseUrl =
              img.metadata?.sourceImage?.url ||
              (selectedImages.length > 0 ? selectedImages[0].url : null);
            setPreviewBase(baseUrl);
          }}
          onPublishFromLibrary={(url) => handlePublishFromLibrary(url)}
          onPreviewLibrary={(url, base) => {
            setPreviewImage(url);
            setPreviewBase(base || null);
          }}
          onRemoveFromLibrary={(url) => {
            setLibraryItemToDelete(url);
          }}
          onUpload={async (files) => {
            const uploadedImages = [];

            for (const file of files) {
              const formData = new FormData();
              formData.set("intent", "upload");
              formData.set("file", file);
              formData.set("productId", product?.id || "");

              const response = await fetch(window.location.pathname, {
                method: "POST",
                body: formData,
              });

              if (!response.ok) {
                const contentType = response.headers.get("content-type");
                if (contentType?.includes("text/html")) {
                  throw new Error(
                    "Server error occurred. Please refresh and try again.",
                  );
                }
              }

              const result = await response.json();

              if (!result.ok) {
                throw new Error(result.error || "Upload failed");
              }

              // Add the uploaded image to our list
              if (result.imageUrl) {
                uploadedImages.push({
                  imageUrl: result.imageUrl,
                  sourceUrl: null
                });
              }
            }

            // Update library items state immediately with the uploaded images
            if (uploadedImages.length > 0) {
              setLibraryItems((prev) => [...uploadedImages, ...prev]);
              shopify.toast.show(`Successfully uploaded ${uploadedImages.length} image${uploadedImages.length !== 1 ? 's' : ''}`);
            }
          }}
          isBusy={
            pendingAction === "publish" || pendingAction === "saveToLibrary"
          }
          pendingAction={pendingAction}
        />
      </BlockStack>
    </Page>
  );
}
