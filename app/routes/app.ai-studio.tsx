import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  TextField,
  Thumbnail,
  Grid,
  Box,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  AIProviderFactory,
  initializeAIProviders,
} from "../services/ai-providers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return { product: null };
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
        metafield(namespace: "dreamshot", key: "ai_drafts") { value }
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

  return {
    product: responseJson.data?.product || null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
  const prompt = String(formData.get("prompt") || "");
  const productId = String(formData.get("productId") || "");
  const intent = String(formData.get("intent") || "generate");

  // Validate only for generation
  if (intent === "generate" && (!sourceImageUrl || !prompt)) {
    return json(
      { ok: false as const, error: "Missing sourceImageUrl or prompt" },
      { status: 400 },
    );
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
      return json(
        { ok: false as const, error: errors[0].message, debug: errors },
        { status: 400 },
      );
    }
    return json({ ok: true as const, published: true });
  }

  if (intent === "saveDraft") {
    const imageUrl = String(formData.get("imageUrl") || "");
    const { admin } = await authenticate.admin(request);
    // Read existing metafield
    const query = `#graphql
      query GetDrafts($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "dreamshot", key: "ai_drafts") { id value }
        }
      }
    `;
    const qRes = await admin.graphql(query, { variables: { id: productId } });
    const qJson = await qRes.json();
    const current = qJson?.data?.product?.metafield?.value;
    let drafts: string[] = [];
    try {
      drafts = current ? JSON.parse(current) : [];
    } catch {
      drafts = [];
    }
    drafts.push(imageUrl);

    const setMutation = `#graphql
      mutation SetDrafts($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: "dreamshot", key: "ai_drafts", type: "json", value: $value }]) {
          userErrors { field message }
        }
      }
    `;
    const sRes = await admin.graphql(setMutation, {
      variables: { ownerId: productId, value: JSON.stringify(drafts) },
    });
    const sJson = await sRes.json();
    const uErr = sJson?.data?.metafieldsSet?.userErrors;
    if (uErr && uErr.length) {
      return json(
        { ok: false as const, error: uErr[0].message },
        { status: 400 },
      );
    }
    return json({ ok: true as const, draftSaved: true });
  }

  // intent === "generate"
  const r2Url = sourceImageUrl; // use public Shopify CDN
  initializeAIProviders();
  const aiProvider = AIProviderFactory.getProvider("fal.ai");
  try {
    const result = await aiProvider.swapModel({
      sourceImageUrl: r2Url,
      prompt,
      productId,
      modelType: "swap",
    });
    return json({
      ok: true as const,
      result: { ...result, originalSource: r2Url },
      debug: { r2Url, prompt },
    });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error(`[action] fal.ai error`, error);
    return json(
      {
        ok: false as const,
        error: error?.message || "Fal.ai error",
        debug: { r2Url, prompt },
      },
      { status: 500 },
    );
  }
};

export default function AIStudio() {
  const { product } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  // State management
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [modelPrompt, setModelPrompt] = useState("");
  const [generatedImages, setGeneratedImages] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showQuickDemo, setShowQuickDemo] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewBase, setPreviewBase] = useState<string | null>(null);
  type DraftItem = { imageUrl: string; sourceUrl?: string | null };
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [pendingAction, setPendingAction] = useState<
    null | "generate" | "publish" | "saveDraft"
  >(null);

  const productId = searchParams.get("productId");
  const selectedImageFromUrl = searchParams.get("selectedImage");

  // Initialize AI providers
  useEffect(() => {
    try {
      initializeAIProviders();
      console.log("✅ AI providers initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize AI providers:", error);
    }
  }, []);

  useEffect(() => {
    if (selectedImageFromUrl) {
      setSelectedImage(selectedImageFromUrl);
    }
  }, [selectedImageFromUrl]);

  useEffect(() => {
    try {
      const raw = (product as any)?.metafield?.value;
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const normalized = arr.map((item: any) =>
          typeof item === "string" ? { imageUrl: item } : item,
        );
        setDrafts(normalized);
      }
    } catch {}
  }, [product]);

  // Handle model swap generation (server-side via action)
  const handleModelSwap = async () => {
    if (!selectedImage || !modelPrompt.trim()) {
      shopify.toast.show(
        "Please select an image and enter a model description",
        { isError: true },
      );
      return;
    }

    setIsGenerating(true);
    setPendingAction("generate");
    try {
      const fd = new FormData();
      fd.set("sourceImageUrl", selectedImage);
      fd.set("prompt", modelPrompt);
      fd.set("productId", product?.id || "");
      fd.set("intent", "generate");
      const res = await fetcher.submit(fd, { method: "post" });
      // fetcher.submit does not return; rely on fetcher.data below
    } catch (error) {
      console.error("❌ Model swap failed:", error);
      // Fallback: Add a mock result for demonstration
      const fallbackResult = {
        id: `fallback_${Date.now()}`,
        imageUrl:
          "https://via.placeholder.com/500x500/FF6B6B/white?text=AI+Generated+Image",
        confidence: 0.85,
        metadata: {
          error: "Demo mode - AI provider failed",
          prompt: modelPrompt,
        },
      };

      setGeneratedImages((prev) => [...prev, fallbackResult]);
      shopify.toast.show("Demo mode: AI provider simulation", {
        isError: false,
      });
    }
  };

  useEffect(() => {
    const data = fetcher.data as
      | ({ ok: true; result: any } & any)
      | ({ ok: true; published: true } & any)
      | ({ ok: true; draftSaved: true } & any)
      | { ok: false; error: string }
      | undefined;
    if (data?.ok && pendingAction === "generate" && (data as any).result) {
      setGeneratedImages((prev) => [...prev, (data as any).result]);
      shopify.toast.show("AI image generated successfully! 🎉");
      setIsGenerating(false);
      setPendingAction(null);
    } else if (data?.ok && pendingAction === "publish") {
      shopify.toast.show("Published to product");
      setPendingAction(null);
    } else if (data?.ok && pendingAction === "saveDraft") {
      shopify.toast.show("Draft saved");
      const img =
        (fetcher.formData?.get &&
          (fetcher.formData.get("imageUrl") as string)) ||
        null;
      if (img) {
        setDrafts((prev) => [
          { imageUrl: img, sourceUrl: selectedImage },
          ...prev,
        ]);
      }
      setPendingAction(null);
    } else if (data && !data.ok) {
      shopify.toast.show(String(data.error), { isError: true });
      if (pendingAction === "generate") setIsGenerating(false);
      setPendingAction(null);
    }
  }, [fetcher.data, pendingAction, shopify]);

  const handlePublishImage = async (image: any) => {
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("imageUrl", image.imageUrl);
    fd.set("productId", product?.id || "");
    setPendingAction("publish");
    fetcher.submit(fd, { method: "post" });
  };

  const handlePublishDraft = (url: string) => {
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("imageUrl", url);
    fd.set("productId", product?.id || "");
    setPendingAction("publish");
    fetcher.submit(fd, { method: "post" });
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
    <Page>
      <TitleBar title={`Product: ${product.title}`}>
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

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {previewImage && (
              <ImagePreviewModal
                url={previewImage}
                baseUrl={previewBase}
                onClose={() => setPreviewImage(null)}
              />
            )}
            {/* Main Content: Images + Model Description + Generation */}
            <Card>
              <BlockStack gap="500">
                <Text as="h3" variant="headingMd">
                  Select Source Image
                </Text>

                <Layout>
                  <Layout.Section variant="oneHalf">
                    {/* Image Selection Grid - larger tiles, preserve image aspect ratio, no double border */}
                    <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2 }}>
                      {product.media?.nodes?.map((media: any) => (
                        <Box key={media.id}>
                          <div
                            onClick={() => setSelectedImage(media.image?.url)}
                            style={{
                              cursor: "pointer",
                              position: "relative",
                              width: "100%",
                              border:
                                selectedImage === media.image?.url
                                  ? "2px solid #008060"
                                  : "1px solid #E1E3E5",
                              borderRadius: "12px",
                              overflow: "hidden",
                              backgroundColor: "#F6F6F7",
                              boxShadow:
                                selectedImage === media.image?.url
                                  ? "0 0 0 2px rgba(0,128,96,0.15)"
                                  : "none",
                            }}
                          >
                            <img
                              src={media.image?.url}
                              alt={media.image?.altText || "Product image"}
                              style={{
                                width: "100%",
                                height: "auto",
                                display: "block",
                              }}
                            />
                            {selectedImage === media.image?.url && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  backgroundColor: "rgba(0, 128, 96, 0.95)",
                                  color: "white",
                                  padding: "4px",
                                  borderRadius: "50%",
                                  fontSize: "14px",
                                  fontWeight: "700",
                                  textAlign: "center",
                                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                                  minWidth: "28px",
                                  height: "28px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                ✓
                              </div>
                            )}
                          </div>
                        </Box>
                      ))}
                    </Grid>
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    {/* Model Description and Generation Controls */}
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingMd">
                        Model Description
                      </Text>
                      <TextField
                        label="Describe the model you want"
                        value={modelPrompt}
                        onChange={setModelPrompt}
                        placeholder="e.g., ginger woman, black male model, blonde model, elderly person..."
                        multiline={3}
                        helpText="Describe the person you want to see wearing this product"
                        autoComplete="off"
                      />

                      {/* Generation Buttons */}
                      <InlineStack gap="300" wrap={false}>
                        <Button
                          variant="primary"
                          size="large"
                          onClick={handleModelSwap}
                          disabled={
                            !selectedImage ||
                            !modelPrompt.trim() ||
                            isGenerating
                          }
                          loading={isGenerating}
                        >
                          {isGenerating
                            ? "🔄 Generating AI Images..."
                            : "🎭 Generate AI Images"}
                        </Button>

                        <Button
                          onClick={() => {
                            setGeneratedImages([
                              {
                                id: "demo_1",
                                imageUrl:
                                  "https://via.placeholder.com/400x400/4ECDC4/white?text=Demo+Result+1",
                                confidence: 0.94,
                                metadata: { demo: true },
                              },
                              {
                                id: "demo_2",
                                imageUrl:
                                  "https://via.placeholder.com/400x400/45B7D1/white?text=Demo+Result+2",
                                confidence: 0.89,
                                metadata: { demo: true },
                              },
                            ]);
                            setShowQuickDemo(true);
                          }}
                        >
                          🧪 Quick Demo
                        </Button>

                        <Button
                          onClick={async () => {
                            if (!selectedImage || !modelPrompt.trim()) {
                              shopify.toast.show(
                                "Please select an image and enter a model description",
                                { isError: true },
                              );
                              return;
                            }

                            setIsGenerating(true);
                            try {
                              // Simular llamada a AI Provider
                              await new Promise((resolve) =>
                                setTimeout(resolve, 2000),
                              );

                              const result = {
                                id: `fal_${Date.now()}`,
                                imageUrl:
                                  "https://via.placeholder.com/400x400/FF6B6B/white?text=FAL.AI+Result",
                                confidence: 0.88,
                                metadata: {
                                  provider: "fal.ai",
                                  operation: "model_swap",
                                  prompt: modelPrompt,
                                  originalImage: selectedImage,
                                },
                              };

                              setGeneratedImages((prev) => [...prev, result]);
                              shopify.toast.show(
                                "AI Provider simulation completed! 🎉",
                              );
                            } catch (error) {
                              shopify.toast.show("AI Provider failed", {
                                isError: true,
                              });
                            } finally {
                              setIsGenerating(false);
                            }
                          }}
                          disabled={
                            !selectedImage ||
                            !modelPrompt.trim() ||
                            isGenerating
                          }
                          loading={isGenerating}
                        >
                          🤖 Test AI Provider
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>

            {/* Generated Images */}
            {generatedImages.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Generated Images ({generatedImages.length})
                  </Text>

                  <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
                    {generatedImages.map((image) => (
                      <Card key={image.id}>
                        <BlockStack gap="300">
                          <div>
                            <img
                              src={image.imageUrl}
                              alt="Generated image"
                              style={{
                                width: "100%",
                                height: "auto",
                                display: "block",
                                borderRadius: "8px",
                                border: "1px solid #E1E3E5",
                              }}
                            />
                          </div>

                          <Text as="p" alignment="center">
                            Confidence:{" "}
                            <strong>
                              {Math.round(image.confidence * 100)}%
                            </strong>
                          </Text>

                          <BlockStack gap="200">
                            <Button
                              onClick={() => handlePublishImage(image)}
                              variant="primary"
                              fullWidth
                            >
                              🚀 Publish to Product
                            </Button>
                            <Button
                              onClick={() => {
                                const fd = new FormData();
                                fd.set("intent", "saveDraft");
                                fd.set("imageUrl", image.imageUrl);
                                fd.set("productId", product?.id || "");
                                setPendingAction("saveDraft");
                                fetcher.submit(fd, { method: "post" });
                              }}
                              fullWidth
                            >
                              💾 Save Draft
                            </Button>
                            <Button
                              onClick={() => {
                                setPreviewImage(image.imageUrl);
                                setPreviewBase(selectedImage);
                              }}
                              fullWidth
                              loading={
                                pendingAction === "publish" ||
                                pendingAction === "saveDraft"
                              }
                            >
                              🔍 Preview
                            </Button>
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    ))}
                  </Grid>
                </BlockStack>
              </Card>
            )}

            {/* Drafts */}
            {drafts.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Drafts ({drafts.length})
                  </Text>
                  <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
                    {drafts.map((d) => (
                      <Card key={typeof d === "string" ? d : d.imageUrl}>
                        <BlockStack gap="300">
                          <div>
                            <img
                              src={
                                typeof d === "string" ? (d as any) : d.imageUrl
                              }
                              alt="Draft image"
                              style={{
                                width: "100%",
                                height: "auto",
                                display: "block",
                                borderRadius: "8px",
                                border: "1px solid #E1E3E5",
                              }}
                            />
                          </div>
                          <BlockStack gap="200">
                            <Button
                              onClick={() =>
                                handlePublishDraft(
                                  typeof d === "string"
                                    ? (d as any)
                                    : d.imageUrl,
                                )
                              }
                              variant="primary"
                              fullWidth
                            >
                              🚀 Publish Draft to Product
                            </Button>
                            <Button
                              onClick={() => {
                                const url =
                                  typeof d === "string"
                                    ? (d as any)
                                    : d.imageUrl;
                                const base =
                                  typeof d === "string"
                                    ? null
                                    : d.sourceUrl || null;
                                setPreviewImage(url);
                                setPreviewBase(base);
                              }}
                              fullWidth
                            >
                              🔍 Preview
                            </Button>
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    ))}
                  </Grid>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Preview modal
function ImagePreviewModal({
  url,
  baseUrl,
  onClose,
}: {
  url: string;
  baseUrl?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Preview"
      primaryAction={{ content: "Close", onAction: onClose }}
    >
      <div style={{ padding: 16 }}>
        {baseUrl ? (
          <div style={{ position: "relative", width: "100%" }}>
            <div style={{ position: "relative" }}>
              <img
                src={baseUrl}
                alt="Original"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
              <div
                id="compare-overlay"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "50%",
                  overflow: "hidden",
                }}
              >
                <img
                  src={url}
                  alt="Generated"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={50}
              onChange={(e) => {
                const percent = Number(e.currentTarget.value);
                const overlay = document.getElementById("compare-overlay");
                if (overlay) overlay.style.width = `${percent}%`;
              }}
              style={{ width: "100%", marginTop: 12 }}
            />
          </div>
        ) : (
          <img
            src={url}
            alt="Preview"
            style={{ width: "100%", height: "auto" }}
          />
        )}
      </div>
    </Modal>
  );
}
