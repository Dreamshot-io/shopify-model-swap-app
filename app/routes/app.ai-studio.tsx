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
  Banner,
  Grid,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  AIProviderFactory,
  initializeAIProviders,
} from "../services/ai-providers";
import { ImagePreviewModal } from "../features/ai-studio/components/ImagePreviewModal";
import { ImageSelector } from "../features/ai-studio/components/ImageSelector";
import { ModelPromptForm } from "../features/ai-studio/components/ModelPromptForm";
import { GeneratedImagesGrid } from "../features/ai-studio/components/GeneratedImagesGrid";
import { DraftsGrid } from "../features/ai-studio/components/DraftsGrid";
import type { DraftItem, GeneratedImage } from "../features/ai-studio/types";

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
    const sourceUrl = String(formData.get("sourceUrl") || "");
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
    let drafts: Array<
      string | { imageUrl: string; sourceUrl?: string | null }
    > = [];
    try {
      drafts = current ? JSON.parse(current) : [];
    } catch {
      drafts = [];
    }
    // Prevent duplicates
    const exists = drafts.some((d: any) =>
      typeof d === "string" ? d === imageUrl : d?.imageUrl === imageUrl,
    );
    if (exists) {
      return json({ ok: true as const, draftSaved: false, duplicate: true });
    }
    // Store as an object so we can preserve the original image for comparison
    drafts.push({ imageUrl, sourceUrl: sourceUrl || null });

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

  if (intent === "deleteDraft") {
    const imageUrl = String(formData.get("imageUrl") || "");
    const { admin } = await authenticate.admin(request);
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
    let drafts: Array<
      string | { imageUrl: string; sourceUrl?: string | null }
    > = [];
    try {
      drafts = current ? JSON.parse(current) : [];
    } catch {
      drafts = [];
    }

    const filtered = drafts.filter((d: any) =>
      typeof d === "string" ? d !== imageUrl : d?.imageUrl !== imageUrl,
    );

    const setMutation = `#graphql
      mutation SetDrafts($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: "dreamshot", key: "ai_drafts", type: "json", value: $value }]) {
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
      return json(
        { ok: false as const, error: uErr[0].message },
        { status: 400 },
      );
    }
    return json({ ok: true as const, deleted: true });
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
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showQuickDemo, setShowQuickDemo] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewBase, setPreviewBase] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [pendingAction, setPendingAction] = useState<
    null | "generate" | "publish" | "saveDraft" | "deleteDraft"
  >(null);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);

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
  const handleGenerate = async (prompt: string) => {
    if (!selectedImage || !prompt.trim()) {
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
      fd.set("prompt", prompt);
      fd.set("productId", product?.id || "");
      fd.set("intent", "generate");
      fetcher.submit(fd, { method: "post" });
    } catch (error) {
      console.error("❌ Model swap failed:", error);
      const fallbackResult: GeneratedImage = {
        id: `fallback_${Date.now()}`,
        imageUrl:
          "https://via.placeholder.com/500x500/FF6B6B/white?text=AI+Generated+Image",
        confidence: 0.85,
        metadata: {
          error: "Demo mode - AI provider failed",
          prompt,
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
      if ((data as any).duplicate) {
        shopify.toast.show("Draft already saved", { isError: false });
      } else if ((data as any).draftSaved) {
        shopify.toast.show("Draft saved");
      }
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
    } else if (data?.ok && pendingAction === "deleteDraft") {
      const img =
        (fetcher.formData?.get &&
          (fetcher.formData.get("imageUrl") as string)) ||
        null;
      if (img) {
        setDrafts((prev) =>
          prev.filter((d) =>
            typeof d === "string" ? d !== img : d.imageUrl !== img,
          ),
        );
      }
      shopify.toast.show("Draft removed");
      setDraftToDelete(null);
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
            {/* Delete confirmation modal */}
            {draftToDelete && (
              <Modal
                open
                onClose={() => setDraftToDelete(null)}
                title="Remove draft?"
                primaryAction={{
                  content: "Delete",
                  destructive: true,
                  onAction: () => {
                    const fd = new FormData();
                    fd.set("intent", "deleteDraft");
                    fd.set("imageUrl", draftToDelete);
                    fd.set("productId", product?.id || "");
                    setPendingAction("deleteDraft");
                    fetcher.submit(fd, { method: "post" });
                  },
                }}
                secondaryActions={[
                  {
                    content: "Cancel",
                    onAction: () => setDraftToDelete(null),
                  },
                ]}
              >
                <BlockStack gap="200">
                  <Text as="p">
                    This will permanently remove the draft image.
                  </Text>
                </BlockStack>
              </Modal>
            )}
            <Card>
              <BlockStack gap="500">
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <ImageSelector
                      media={product.media?.nodes || []}
                      selectedImage={selectedImage}
                      onSelect={(url) => setSelectedImage(url)}
                    />
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <ModelPromptForm
                      disabled={!selectedImage || isGenerating}
                      onGenerate={handleGenerate}
                    />
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>

            <GeneratedImagesGrid
              images={generatedImages}
              onPublish={(img) => handlePublishImage(img)}
              onSaveDraft={(img) => {
                const fd = new FormData();
                fd.set("intent", "saveDraft");
                fd.set("imageUrl", img.imageUrl);
                fd.set("sourceUrl", selectedImage || "");
                fd.set("productId", product?.id || "");
                setPendingAction("saveDraft");
                fetcher.submit(fd, { method: "post" });
              }}
              onPreview={(img) => {
                setPreviewImage(img.imageUrl);
                setPreviewBase(selectedImage);
              }}
              isBusy={
                pendingAction === "publish" || pendingAction === "saveDraft"
              }
            />

            <DraftsGrid
              drafts={drafts}
              onPublish={(url) => handlePublishDraft(url)}
              onPreview={(url, base) => {
                setPreviewImage(url);
                setPreviewBase(base || null);
              }}
              onRemove={(url) => {
                setDraftToDelete(url);
              }}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
