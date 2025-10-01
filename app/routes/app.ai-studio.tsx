import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher } from "@remix-run/react";
import { Page, Text, Card, BlockStack, Banner, Modal } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  generateAIImage,
  checkAIProviderHealth,
} from "../services/ai-providers.server";
import { ImagePreviewModal } from "../features/ai-studio/components/ImagePreviewModal";
import { ImageSelector } from "../features/ai-studio/components/ImageSelector";
import { ModelPromptForm } from "../features/ai-studio/components/ModelPromptForm";
import { GeneratedImagesGrid } from "../features/ai-studio/components/GeneratedImagesGrid";
import { LibraryGrid } from "../features/ai-studio/components/LibraryGrid";
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
    return { product: null, abTests: [], activeTest: null };
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
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<Response> => {
  try {
    const formData = await request.formData();
    const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
    const prompt = String(formData.get("prompt") || "");
    const productId = String(formData.get("productId") || "");
    const intent = String(formData.get("intent") || "generate");
    const { session } = await authenticate.admin(request);

    // Validate only for generation
    if (intent === "generate" && (!sourceImageUrl || !prompt)) {
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: "Missing sourceImageUrl or prompt",
      };
      return json(errorResponse, { status: 400 });
    }

    if (intent === "publish") {
      const imageUrl = String(formData.get("imageUrl") || "");
      const { admin } = await authenticate.admin(request);
      const mutation = `
      mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { id }
          mediaUserErrors { field message code }
        }
      }
    `;
      const resp = await admin.graphql(mutation, {
        variables: {
          productId,
          media: [
            {
              originalSource: imageUrl,
              mediaContentType: "IMAGE",
              alt: "AI generated image",
            },
          ],
        },
      });
      const jsonRes = await resp.json();
      const errors = jsonRes?.data?.productCreateMedia?.mediaUserErrors;
      if (errors && errors.length) {
        const errorResponse: ActionErrorResponse = {
          ok: false,
          error: errors[0].message,
          debug: errors,
        };
        return json(errorResponse, { status: 400 });
      }
      // Log publish event
      try {
        await (db as any).metricEvent.create({
          data: {
            shop: session.shop,
            type: "PUBLISHED",
            productId,
            imageUrl,
          },
        });
      } catch {}
      const successResponse: PublishImageResponse = {
        ok: true,
        published: true,
      };
      return json(successResponse);
    }

    if (intent === "saveToLibrary") {
      const imageUrl = String(formData.get("imageUrl") || "");
      const sourceUrl = String(formData.get("sourceUrl") || "");
      const { admin } = await authenticate.admin(request);
      // Read existing metafield
      const query = `#graphql
      query GetLibrary($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "dreamshot", key: "ai_library") { id value }
        }
      }
    `;
      const qRes = await admin.graphql(query, { variables: { id: productId } });
      const qJson = await qRes.json();
      const current = qJson?.data?.product?.metafield?.value;
      let libraryItems: Array<
        string | { imageUrl: string; sourceUrl?: string | null }
      > = [];
      try {
        libraryItems = current ? JSON.parse(current) : [];
      } catch {
        libraryItems = [];
      }
      // Prevent duplicates
      const exists = libraryItems.some((item: any) =>
        typeof item === "string"
          ? item === imageUrl
          : item?.imageUrl === imageUrl,
      );
      if (exists) {
        const duplicateResponse: LibraryActionResponse = {
          ok: true,
          savedToLibrary: false,
          duplicate: true,
        };
        return json(duplicateResponse);
      }
      // Store as an object so we can preserve the original image for comparison
      libraryItems.push({ imageUrl, sourceUrl: sourceUrl || null });

      const setMutation = `#graphql
      mutation SetLibrary($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: "dreamshot", key: "ai_library", type: "json", value: $value }]) {
          userErrors { field message }
        }
      }
    `;
      const sRes = await admin.graphql(setMutation, {
        variables: { ownerId: productId, value: JSON.stringify(libraryItems) },
      });
      const sJson = await sRes.json();
      const uErr = sJson?.data?.metafieldsSet?.userErrors;
      if (uErr && uErr.length) {
        const errorResponse: ActionErrorResponse = {
          ok: false,
          error: uErr[0].message,
        };
        return json(errorResponse, { status: 400 });
      }
      // Log library saved event
      try {
        await (db as any).metricEvent.create({
          data: {
            shop: session.shop,
            type: "LIBRARY_SAVED",
            productId,
            imageUrl,
          },
        });
      } catch {}
      const successResponse: LibraryActionResponse = {
        ok: true,
        savedToLibrary: true,
      };
      return json(successResponse);
    }

    if (intent === "deleteFromLibrary") {
      const imageUrl = String(formData.get("imageUrl") || "");
      const { admin } = await authenticate.admin(request);
      const query = `#graphql
      query GetLibrary($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "dreamshot", key: "ai_library") { id value }
        }
      }
    `;
      const qRes = await admin.graphql(query, { variables: { id: productId } });
      const qJson = await qRes.json();
      const current = qJson?.data?.product?.metafield?.value;
      let libraryItems: Array<
        string | { imageUrl: string; sourceUrl?: string | null }
      > = [];
      try {
        libraryItems = current ? JSON.parse(current) : [];
      } catch {
        libraryItems = [];
      }

      const filtered = libraryItems.filter((item: any) =>
        typeof item === "string"
          ? item !== imageUrl
          : item?.imageUrl !== imageUrl,
      );

      const setMutation = `#graphql
      mutation SetLibrary($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: "dreamshot", key: "ai_library", type: "json", value: $value }]) {
          userErrors { field message }
        }
      }
    `;
      const sRes = await admin.graphql(setMutation, {
        variables: { ownerId: productId, value: JSON.stringify(filtered) },
      });
      const sJson = await sRes.json();
      const uErr = sJson?.data?.metafieldsSet?.userErrors;
      if (uErr && uErr.length) {
        const errorResponse: ActionErrorResponse = {
          ok: false,
          error: uErr[0].message,
        };
        return json(errorResponse, { status: 400 });
      }
      // Log library item deleted event
      try {
        await (db as any).metricEvent.create({
          data: {
            shop: session.shop,
            type: "LIBRARY_DELETED",
            productId,
            imageUrl,
          },
        });
      } catch {}
      const successResponse: LibraryActionResponse = {
        ok: true,
        deletedFromLibrary: true,
      };
      return json(successResponse);
    }

    // Health check for AI providers
    const healthCheck = checkAIProviderHealth();
    if (!healthCheck.healthy) {
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: `AI service unavailable: ${healthCheck.error}`,
      };
      return json(errorResponse, { status: 503 });
    }

    // intent === "generate"
    const r2Url = sourceImageUrl; // use public Shopify CDN

    try {
      const result = await generateAIImage({
        sourceImageUrl: r2Url,
        prompt,
        productId,
        modelType: "swap",
      });

      // Log generated image event
      try {
        await (db as any).metricEvent.create({
          data: {
            shop: session.shop,
            type: "GENERATED",
            productId,
            imageUrl: result.imageUrl,
          },
        });
      } catch (loggingError) {
        console.warn("Failed to log metric event:", loggingError);
        // Continue execution - logging failure shouldn't break the flow
      }

      const successResponse: GenerateImageResponse = {
        ok: true,
        result: { ...result, originalSource: r2Url },
        debug: { r2Url, prompt },
      };
      return json(successResponse);
    } catch (error: any) {
      console.error(`[action] AI generation error:`, {
        error: error.message,
        stack: error.stack,
        sourceImageUrl: r2Url,
        prompt,
        productId,
      });

      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: error?.message || "AI image generation failed",
        debug: { r2Url, prompt, errorType: error.constructor.name },
      };
      return json(errorResponse, { status: 500 });
    }
  } catch (globalError: any) {
    console.error("[action] Unexpected error:", globalError);

    // Ensure we always return JSON, never HTML
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
  const { product, abTests, activeTest } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

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
  }, [fetcher.data, pendingAction, shopify, batchProcessingState.isProcessing]);

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

  const handleABTestCreate = async (request: any) => {
    try {
      const fd = new FormData();
      fd.set("intent", "create");
      fd.set("name", request.name);
      fd.set("productId", request.productId);
      fd.set("variantAImages", JSON.stringify(request.variantAImages));
      fd.set("variantBImages", JSON.stringify(request.variantBImages));
      fd.set("trafficSplit", String(request.trafficSplit || 50));

      const response = await fetch("/app/ab-tests", {
        method: "POST",
        body: fd,
      });

      const result = await response.json();

      if (result.ok) {
        shopify.toast.show(
          `A/B test "${request.name}" created successfully! 🎉`,
        );
        // Refresh the page to show the new test
        window.location.reload();
      } else {
        shopify.toast.show(result.error || "Failed to create A/B test", {
          isError: true,
        });
      }
    } catch (error) {
      console.error("Failed to create A/B test:", error);
      shopify.toast.show("Failed to create A/B test", { isError: true });
    }
  };

  const handleABTestAction = async (
    testId: string,
    action: "start" | "stop" | "delete",
  ) => {
    try {
      const fd = new FormData();
      fd.set("intent", action);
      fd.set("testId", testId);

      const response = await fetch("/app/ab-tests", {
        method: "POST",
        body: fd,
      });

      const result = await response.json();

      if (result.ok) {
        if (action === "delete") {
          shopify.toast.show("A/B test deleted successfully");
        } else if (action === "start") {
          shopify.toast.show("A/B test started successfully");
        } else if (action === "stop") {
          shopify.toast.show("A/B test stopped successfully");
        }
        // Refresh the page to show the updated test state
        window.location.reload();
      } else {
        shopify.toast.show(result.error || `Failed to ${action} A/B test`, {
          isError: true,
        });
      }
    } catch (error) {
      console.error(`Failed to ${action} A/B test:`, error);
      shopify.toast.show(`Failed to ${action} A/B test`, { isError: true });
    }
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
    return (
      <Page>
        <TitleBar title="AI Image Studio" />
        <Banner tone="critical">
          <Text as="p">
            No product selected. Please go back and select a product.
          </Text>
        </Banner>
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

        {/* A/B Testing Section - Now at the top */}
        <ABTestManager
          productId={product?.id || ""}
          availableImages={getAllImages()}
          existingTests={abTests || []}
          activeTest={activeTest}
          onTestCreate={handleABTestCreate}
          onTestAction={handleABTestAction}
          isCreating={false}
        />
        {/* Delete confirmation modal */}
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

        {/* AI Image Generation Section */}
        <Card>
          <BlockStack gap="500">
            <Text as="h2" variant="headingLg">
              AI Image Generation
            </Text>

            {/* Images in horizontal row at top */}
            <ImageSelector
              media={product.media?.nodes || []}
              libraryItems={libraryItems}
              generatedImages={generatedImages}
              selectedImages={selectedImages}
              onSelect={handleImageSelect}
              onClearSelection={handleClearSelection}
            />

            {/* Model prompt form below - full width */}
            <ModelPromptForm
              disabled={selectedImages.length === 0}
              selectedImageCount={selectedImages.length}
              batchProcessingState={batchProcessingState}
              onGenerate={handleGenerate}
            />
          </BlockStack>
        </Card>

        <GeneratedImagesGrid
          images={generatedImages}
          onPublish={(img) => handlePublishImage(img)}
          onSaveToLibrary={(img) => {
            const fd = new FormData();
            fd.set("intent", "saveToLibrary");
            fd.set("imageUrl", img.imageUrl);
            // Use the source image from metadata if available
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
            // Use the source image from metadata if available
            const baseUrl =
              img.metadata?.sourceImage?.url ||
              (selectedImages.length > 0 ? selectedImages[0].url : null);
            setPreviewBase(baseUrl);
          }}
          isBusy={
            pendingAction === "publish" || pendingAction === "saveToLibrary"
          }
        />

        <LibraryGrid
          libraryItems={libraryItems}
          onPublish={(url) => handlePublishFromLibrary(url)}
          onPreview={(url, base) => {
            setPreviewImage(url);
            setPreviewBase(base || null);
          }}
          onRemove={(url) => {
            setLibraryItemToDelete(url);
          }}
        />
      </BlockStack>
    </Page>
  );
}
