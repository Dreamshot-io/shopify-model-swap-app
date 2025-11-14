import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Badge,
  DataTable,
  ProgressBar,
  Divider,
  Icon,
  Modal,
  Popover,
} from "@shopify/polaris";
import {
  PlusCircleIcon,
  CheckCircleIcon,
  QuestionCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { SimpleRotationService } from "../services/simple-rotation.server";
import { AuditService } from "../services/audit.server";
import { MediaGalleryService } from "../services/media-gallery.server";
import {
  ProductSelector,
  ProductNavigationTabs,
} from "../features/shared/components";
import { ABTestCreationForm } from "../features/ab-testing/components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    if (!productId) {
      // STATE 1: Product Selection View
      const productsResponse = await admin.graphql(
        `#graphql
          query GetProducts {
            products(first: 50, sortKey: UPDATED_AT, reverse: true) {
              edges {
                node {
                  id
                  title
                  status
                  featuredImage {
                    url
                    altText
                  }
                }
              }
            }
          }
        `,
      );

      const productsData = await productsResponse.json();
      const products =
        productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

      // Get test counts per product for badges
      const tests = await db.aBTest.findMany({
        where: { shop: session.shop },
        select: { productId: true, status: true },
      });

      const testCounts: Record<string, { count: number; hasActive: boolean }> =
        {};
      tests.forEach((test) => {
        if (!testCounts[test.productId]) {
          testCounts[test.productId] = { count: 0, hasActive: false };
        }
        testCounts[test.productId].count++;
        if (test.status === "ACTIVE") {
          testCounts[test.productId].hasActive = true;
        }
      });

      return json({
        view: "productSelection" as const,
        products,
        testCounts,
      });
    }

    // STATE 2: Product Test Management View
    const productResponse = await admin.graphql(
      `#graphql
        query GetProduct($id: ID!) {
          product(id: $id) {
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
      `,
      { variables: { id: productId } },
    );

    const productData = await productResponse.json();
    const product = productData.data?.product;
    const shop = session.shop;

    if (!product) {
      return json({ error: "Product not found" }, { status: 404 });
    }

    // Fetch all tests for this product
    const tests = await db.aBTest.findMany({
      where: {
        shop: session.shop,
        productId,
      },
      include: {
        variants: true,
        events: {
          take: 1000,
        },
        rotationEvents: {
          take: 20,
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate statistics for each test
    const testsWithStats = tests.map((test) => {
      const baseEvents = test.events.filter((e) => e.activeCase === "BASE");
      const testEvents = test.events.filter((e) => e.activeCase === "TEST");

      const baseImpressions = baseEvents.filter(
        (e) => e.eventType === "IMPRESSION",
      ).length;
      const testImpressions = testEvents.filter(
        (e) => e.eventType === "IMPRESSION",
      ).length;

      const baseConversions = baseEvents.filter(
        (e) => e.eventType === "PURCHASE",
      ).length;
      const testConversions = testEvents.filter(
        (e) => e.eventType === "PURCHASE",
      ).length;

      const baseCVR =
        baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
      const testCVR =
        testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;
      const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

      return {
        ...test,
        statistics: {
          base: {
            impressions: baseImpressions,
            conversions: baseConversions,
            cvr: baseCVR,
          },
          test: {
            impressions: testImpressions,
            conversions: testConversions,
            cvr: testCVR,
          },
          lift,
        },
      };
    });

    const activeTest = testsWithStats.find(
      (t) => t.status === "ACTIVE" || t.status === "PAUSED",
    );
    const draftTests = testsWithStats.filter((t) => t.status === "DRAFT");
    const completedTests = testsWithStats.filter(
      (t) => t.status === "COMPLETED",
    );

    return json({
      view: "productTests" as const,
      product,
      productId,
      shop,
      tests: testsWithStats,
      activeTest,
      draftTests,
      completedTests,
    });
  } catch (error) {
    console.error("Loader error:", error);
    // Safely extract error message without relying on instanceof
    const errorMessage =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
        ? error
        : "An error occurred";
    return json(
      { error: errorMessage },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "create": {
        const name = formData.get("name") as string;
        const productId = formData.get("productId") as string;
        const testImagesJson = formData.get("testImages") as string;
        const variantTestsJson = formData.get("variantTests") as string;

        if (!name || !productId) {
          return json(
            { success: false, error: "Missing required fields" },
            { status: 400 },
          );
        }

        // Parse gallery images (optional)
        let testImages: any[] = [];
        if (testImagesJson) {
          try {
            testImages = JSON.parse(testImagesJson);
          } catch (e) {
            testImages = [];
          }
        }

        // Parse variant tests (optional)
        let variantTests: any[] = [];
        if (variantTestsJson) {
          try {
            const parsed = JSON.parse(variantTestsJson);
            // Validate and filter variant tests to ensure they have required structure
            variantTests = Array.isArray(parsed)
              ? parsed.filter(
                  (v: any) =>
                    v &&
                    typeof v === 'object' &&
                    v.variantId &&
                    v.heroImage &&
                    typeof v.heroImage === 'object' &&
                    v.heroImage.url &&
                    typeof v.heroImage.url === 'string',
                )
              : [];
          } catch (e) {
            variantTests = [];
          }
        }

        // Must have at least gallery images OR variant tests
        if (testImages.length === 0 && variantTests.length === 0) {
          return json(
            {
              success: false,
              error: "Select at least gallery images or variant heroes",
            },
            { status: 400 },
          );
        }

        if (testImages.length === 0) {
          return json(
            {
              success: false,
              error: "Select at least one gallery image for the test case",
            },
            { status: 400 },
          );
        }

        const normalizeUrl = (url: string) => {
          if (!url) return "";
          const [base] = url.split("?");
          return base;
        };

        const mediaGallery = new MediaGalleryService(admin as AdminApiContext);

        // Get assigned product media for base case
        const productMedia = await mediaGallery.getProductMedia(productId);

        // Validate test images exist in Shopify media library (may not be assigned to product)
        const testImageUrls = testImages.map((img: any) => img?.url).filter(Boolean);
        const mediaValidation = await mediaGallery.validateMediaByUrl(productId, testImageUrls);

        if (mediaValidation.missing.length > 0) {
          return json(
            {
              success: false,
              error: `Test images not found in Shopify media library: ${mediaValidation.missing.join(", ")}`,
            },
            { status: 400 },
          );
        }

        // Build media map from assigned product media
        const mediaByUrl = new Map(
          productMedia.map((media, index) => [
            normalizeUrl(media.url),
            {
              id: media.id,
              url: media.url,
              altText: media.altText || undefined,
              position: index,
            },
          ]),
        );

        // Add validated test images to map (may not be in assigned media)
        // This ensures all validated images are available for matching
        console.log(`[ABTest] Validated ${mediaValidation.found.length} test images`);
        for (const foundMedia of mediaValidation.found) {
          const normalizedUrl = normalizeUrl(foundMedia.url);
          console.log(`[ABTest] Processing validated image: ${foundMedia.url} -> normalized: ${normalizedUrl}, mediaId: ${foundMedia.mediaId || '(empty)'}`);

          if (!mediaByUrl.has(normalizedUrl)) {
            // Add to map even if mediaId is empty (will be resolved later)
            mediaByUrl.set(normalizedUrl, {
              id: foundMedia.mediaId || '', // May be empty, will be resolved
              url: foundMedia.url,
              altText: foundMedia.altText,
              position: mediaByUrl.size,
            });
            console.log(`[ABTest] Added to mediaByUrl map: ${normalizedUrl}`);
          } else {
            const existing = mediaByUrl.get(normalizedUrl);
            console.log(`[ABTest] Already in map: ${normalizedUrl}, existing id: ${existing?.id || '(empty)'}`);
            if (foundMedia.mediaId && !existing?.id) {
              // Update existing entry with mediaId if it was missing
              if (existing) {
                existing.id = foundMedia.mediaId;
                console.log(`[ABTest] Updated mediaId: ${foundMedia.mediaId}`);
              }
            }
          }
        }

        console.log(`[ABTest] mediaByUrl map now has ${mediaByUrl.size} entries`);

        const baseImages = productMedia.map((media, index) => ({
          mediaId: media.id,
          url: media.url,
          altText: media.altText || undefined,
          position: index,
        }));

        const baseMediaIds = baseImages.map((img) => img.mediaId);

        // Resolve test images (handle async mediaId resolution)
        const resolvedTestImages = await Promise.all(
          testImages.map(async (img: any, index: number) => {
            const normalizedUrl = normalizeUrl(img?.url);
            console.log(`[ABTest] Looking up test image: ${img?.url} -> normalized: ${normalizedUrl}`);
            const matched = normalizedUrl ? mediaByUrl.get(normalizedUrl) : undefined;

            if (!matched) {
              // This shouldn't happen after validation, but handle gracefully
              console.error(`[ABTest] Image not found in mediaByUrl map. Available keys:`, Array.from(mediaByUrl.keys()));
              throw new Error(
                `Test image ${img?.url ?? "(missing URL)"} could not be matched to Shopify media.`,
              );
            }

            console.log(`[ABTest] Matched image: ${img?.url} -> mediaId: ${matched.id || '(empty, will resolve)'}`);

            // If mediaId is empty, try to resolve it by querying Shopify files API
            if (!matched.id) {
              try {
                // Extract filename from URL for better querying
                const urlPath = new URL(matched.url).pathname;
                const filename = urlPath.split('/').pop() || '';

                console.log(`[ABTest] Attempting to resolve mediaId for: ${matched.url}, filename: ${filename}`);

                // Try querying by filename first
                let fileResponse = await admin.graphql(
                  `#graphql
                  query FindMediaByFilename($query: String!) {
                    files(first: 10, query: $query) {
                      edges {
                        node {
                          ... on MediaImage {
                            id
                            image {
                              url
                              altText
                            }
                          }
                        }
                      }
                    }
                  }`,
                  {
                    variables: {
                      query: `filename:${filename}`,
                    },
                  }
                );

                let fileData = await fileResponse.json();
                let fileNode = fileData.data?.files?.edges?.find((edge: any) => {
                  const nodeUrl = edge.node?.image?.url;
                  return nodeUrl && normalizeUrl(nodeUrl) === normalizeUrl(matched.url);
                })?.node;

                // If not found by filename, try by URL
                if (!fileNode) {
                  console.log(`[ABTest] Not found by filename, trying URL query`);
                  fileResponse = await admin.graphql(
                    `#graphql
                    query FindMediaByUrl($query: String!) {
                      files(first: 10, query: $query) {
                        edges {
                          node {
                            ... on MediaImage {
                              id
                              image {
                                url
                                altText
                              }
                            }
                          }
                        }
                      }
                    }`,
                    {
                      variables: {
                        query: `url:*${filename}*`,
                      },
                    }
                  );

                  fileData = await fileResponse.json();
                  fileNode = fileData.data?.files?.edges?.find((edge: any) => {
                    const nodeUrl = edge.node?.image?.url;
                    return nodeUrl && normalizeUrl(nodeUrl) === normalizeUrl(matched.url);
                  })?.node;
                }

                if (fileNode && fileNode.id) {
                  matched.id = fileNode.id;
                  matched.altText = fileNode.image?.altText || matched.altText;
                  console.log(`[ABTest] Successfully resolved mediaId: ${fileNode.id}`);
                } else {
                  // Last resort: create media on product from URL to get mediaId
                  console.log(`[ABTest] MediaId not found via files API, creating media on product from URL`);
                  try {
                    const createMediaResponse = await admin.graphql(
                      `#graphql
                      mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                        productCreateMedia(productId: $productId, media: $media) {
                          media {
                            id
                            ... on MediaImage {
                              id
                              image {
                                url
                                altText
                              }
                            }
                          }
                          mediaUserErrors {
                            field
                            message
                            code
                          }
                        }
                      }`,
                      {
                        variables: {
                          productId,
                          media: [{
                            originalSource: matched.url,
                            mediaContentType: "IMAGE",
                            alt: matched.altText || "Test image",
                          }],
                        },
                      }
                    );

                    const createData = await createMediaResponse.json();
                    const mediaErrors = createData.data?.productCreateMedia?.mediaUserErrors || [];

                    if (mediaErrors.length > 0) {
                      throw new Error(
                        `Failed to create media: ${mediaErrors.map((e: any) => e.message).join(", ")}`
                      );
                    }

                    const createdMedia = createData.data?.productCreateMedia?.media?.[0];
                    if (createdMedia && createdMedia.id) {
                      matched.id = createdMedia.id;
                      matched.altText = createdMedia.image?.altText || matched.altText;
                      console.log(`[ABTest] Successfully created media and got mediaId: ${createdMedia.id}`);
                    } else {
                      throw new Error(
                        `Test image ${img?.url ?? "(missing URL)"} was created on product but mediaId could not be retrieved.`,
                      );
                    }
                  } catch (createError) {
                    throw new Error(
                      `Test image ${img?.url ?? "(missing URL)"} exists in library but could not be created on product: ${createError instanceof Error ? createError.message : "Unknown error"}`,
                    );
                  }
                }
              } catch (error) {
                console.error(`[ABTest] Error resolving mediaId:`, error);
                throw new Error(
                  `Test image ${img?.url ?? "(missing URL)"} exists in library but mediaId could not be resolved: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }

            return {
              mediaId: matched.id,
              url: matched.url,
              altText: matched.altText,
              position:
                typeof img?.position === "number" && !Number.isNaN(img.position)
                  ? img.position
                  : index,
            };
          })
        );

        // Sort and reindex positions
        const sortedTestImages = resolvedTestImages
          .sort((a, b) => a.position - b.position)
          .map((img, idx) => ({
            ...img,
            position: idx,
          }));

        // Use only the test images - don't fill with base images
        const testMediaIds = sortedTestImages.map((img) => img.mediaId);

        const variantHeroSelections: Array<{
          variantId: string;
          variantName: string;
          baseHeroMediaId: string | null;
          baseHeroImage?: { url: string; mediaId: string; position: number };
          testHeroMediaId: string | null;
          testHeroImage: { url: string; mediaId: string; position: number };
        }> = [];

        if (variantTests.length > 0) {
          const variantResponse = await admin.graphql(
            `#graphql
              query GetVariantHeroes($productId: ID!) {
                product(id: $productId) {
                  variants(first: 250) {
                    edges {
                      node {
                        id
                        displayName
                        image {
                          id
                          url
                        }
                      }
                    }
                  }
                }
              }`,
            { variables: { productId } },
          );

          const variantData = await variantResponse.json();
          const variantEdges =
            variantData.data?.product?.variants?.edges ?? [];

          const variantMap = new Map<
            string,
            {
              displayName: string;
              baseHeroMediaId: string | null;
              baseHeroUrl: string | null;
            }
          >();

          for (const edge of variantEdges) {
            const node = edge?.node;
            if (!node?.id) {
              continue;
            }
            variantMap.set(node.id, {
              displayName: node.displayName || node.id,
              baseHeroMediaId: node.image?.id ?? null,
              baseHeroUrl: node.image?.url ?? null,
            });
          }

          for (const variantTest of variantTests) {
            const variantId = variantTest.variantId;
            const variantInfo = variantMap.get(variantId);

            if (!variantInfo) {
              throw new Error(`Variant ${variantId} not found on the product`);
            }

            const normalizedHeroUrl = normalizeUrl(variantTest.heroImage?.url);
            const heroMedia = normalizedHeroUrl
              ? mediaByUrl.get(normalizedHeroUrl)
              : undefined;

            if (!heroMedia) {
              throw new Error(
                `Variant hero image ${variantTest.heroImage?.url ?? "(missing URL)"} is not present in the Shopify product gallery.`,
              );
            }

            variantHeroSelections.push({
              variantId,
              variantName: variantInfo.displayName,
              baseHeroMediaId: variantInfo.baseHeroMediaId,
              baseHeroImage:
                variantInfo.baseHeroMediaId && variantInfo.baseHeroUrl
                  ? {
                      url: variantInfo.baseHeroUrl,
                      mediaId: variantInfo.baseHeroMediaId,
                      position: 0,
                    }
                  : undefined,
              testHeroMediaId: heroMedia.id,
              testHeroImage: {
                url: heroMedia.url,
                mediaId: heroMedia.id,
                position: 0,
              },
            });
          }
        }

        // Create the test (default 30 minute rotation)
        const test = await db.aBTest.create({
          data: {
            shop: session.shop,
            productId,
            name,
            status: "DRAFT",
            trafficSplit: 50,
            baseImages,
            testImages: sortedTestImages,
            baseMediaIds,
            testMediaIds,
            currentCase: "BASE",
            rotationHours: 0.5, // Default 30 minutes
            createdBy: session.id,
          },
        });

        for (const heroSelection of variantHeroSelections) {
          await db.aBTestVariant.create({
            data: {
              testId: test.id,
              shopifyVariantId: heroSelection.variantId,
              variantName: heroSelection.variantName,
              baseHeroMediaId: heroSelection.baseHeroMediaId,
              testHeroMediaId: heroSelection.testHeroMediaId,
              baseHeroImage: heroSelection.baseHeroImage ?? Prisma.JsonNull,
              testHeroImage: heroSelection.testHeroImage,
            },
          });
        }

        await AuditService.logTestCreated(test, session.id, {
          hasGalleryTest: testImages.length > 0,
          galleryImagesCount: testImages.length,
          hasVariantTest: variantTests.length > 0,
          variantCount: variantTests.length,
        });

        return json({ success: true, testId: test.id });
      }

      case "start": {
        const testId = formData.get("testId") as string;
        await SimpleRotationService.startTest(testId, session.id);
        return json({ success: true, message: "Test started" });
      }

      case "pause": {
        const testId = formData.get("testId") as string;
        await SimpleRotationService.pauseTest(
          testId,
          session.id,
          admin as AdminApiContext,
        );
        return json({
          success: true,
          message: "Test paused and restored to base case",
        });
      }

      case "complete": {
        const testId = formData.get("testId") as string;
        await SimpleRotationService.completeTest(
          testId,
          admin as AdminApiContext,
          session.id,
        );
        return json({ success: true, message: "Test completed" });
      }

      case "delete": {
        const testId = formData.get("testId") as string;
        const test = await db.aBTest.findUnique({ where: { id: testId } });

        if (test) {
          await AuditService.logTestDeleted(
            testId,
            test.name,
            session.shop,
            session.id,
          );
          await db.aBTest.delete({ where: { id: testId } });
        }

        return json({ success: true, message: "Test deleted" });
      }

      case "rotate": {
        const testId = formData.get("testId") as string;
        try {
          const result = await SimpleRotationService.rotateTest(
            testId,
            "MANUAL",
            session.id,
            admin as AdminApiContext,
          );
          return json({ success: true, message: "Rotation completed", result });
        } catch (error) {
          const errorMessage =
            error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
              ? error.message
              : typeof error === 'string'
              ? error
              : "Rotation failed";
          return json(
            { success: false, error: errorMessage },
            { status: 500 },
          );
        }
      }

      default:
        return json(
          { success: false, error: "Unknown intent" },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Action error:", error);
    // Safely extract error message without relying on instanceof or type assertions
    const errorMessage =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
        ? error
        : "An error occurred";
    return json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
};

function formatRotationHours(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  if (hours === Math.floor(hours)) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

export default function ABTests() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [rotationHelpActive, setRotationHelpActive] = useState(false);

  // Calculate countdown timer
  useEffect(() => {
    if (
      !data ||
      data.view !== "productTests" ||
      !data.activeTest?.nextRotation
    ) {
      setCountdown("");
      return;
    }

    const updateCountdown = () => {
      try {
        if (data.view === "productTests" && data.activeTest?.nextRotation) {
          const now = new Date().getTime();
          const nextRotation = new Date(data.activeTest.nextRotation).getTime();

          if (isNaN(nextRotation)) {
            setCountdown("");
            return;
          }

          const diff = nextRotation - now;

          if (diff > 0) {
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            setCountdown(`${hours}h ${minutes}m`);
          } else {
            setCountdown("Due now");
          }
        }
      } catch (error) {
        console.error("Error updating countdown:", error);
        setCountdown("");
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [data?.view, data?.activeTest?.nextRotation]);

  // Show toast on success or error - must be before any conditional returns
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.success === false && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  // Handle loader errors
  if ("error" in data) {
    return (
      <Page>
        <TitleBar title="A/B Tests" />
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2" tone="critical">
              Error
            </Text>
            <Text as="p">{data.error}</Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  // STATE 1: Product Selection
  if (data.view === "productSelection") {
    const badgeData: Record<
      string,
      { count: number; tone: "success" | "info" }
    > = {};
    Object.entries(data.testCounts).forEach(([productId, info]) => {
      badgeData[productId] = {
        count: info.count,
        tone: info.hasActive ? "success" : "info",
      };
    });

    return (
      <Page>
        <TitleBar title="A/B Tests" />
        <ProductSelector
          products={data.products}
          onSelectProduct={(id) =>
            navigate(`/app/ab-tests?productId=${encodeURIComponent(id)}`)
          }
          title="Select a Product"
          description="Choose a product to manage its A/B tests"
          emptyStateHeading="No products found"
          emptyStateMessage="Create products in your store to start A/B testing"
          showBadges={true}
          badgeData={badgeData}
        />
      </Page>
    );
  }

  // STATE 2: Product Test Management
  const handleAction = (testId: string, intent: string) => {
    if (intent === "complete") {
      setShowCompleteModal(true);
    } else {
      fetcher.submit({ testId, intent }, { method: "post" });
    }
  };

  const handleCompleteConfirm = () => {
    if (data.view === "productTests" && data.activeTest) {
      fetcher.submit(
        { testId: data.activeTest.id, intent: "complete" },
        { method: "post" },
      );
      setShowCompleteModal(false);
    }
  };

  return (
    <Page fullWidth>
      <TitleBar title={`A/B Tests - ${data.product.title}`}>
        <button
          onClick={() => {
            const productNumericId = data.productId.replace(
              "gid://shopify/Product/",
              "",
            );
            window.open(`shopify:admin/products/${productNumericId}`, "_blank");
          }}
        >
          View Product
        </button>
        <button
          onClick={() => {
            window.open(
              `https://${data.shop}/products/${data.product.handle}`,
              "_blank",
            );
          }}
        >
          View in Store
        </button>
        <button variant="primary" onClick={() => setShowCreateForm(true)}>
          + Create New Test
        </button>
      </TitleBar>

      <ProductNavigationTabs
        productId={data.productId}
        currentPage="ab-tests"
      />

      <Layout>
        {/* Empty State - Create New Test Card */}
        {!data.activeTest &&
          data.draftTests.length === 0 &&
          !showCreateForm && (
            <Layout.Section>
              <Card>
                <BlockStack gap="500" align="center" inlineAlign="center">
                  <div
                    style={{
                      padding: "40px 0",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "20px",
                      cursor: "pointer",
                      width: "100%",
                      maxWidth: "400px",
                    }}
                    onClick={() => setShowCreateForm(true)}
                  >
                    <div
                      style={{
                        width: "80px",
                        height: "80px",
                        borderRadius: "50%",
                        backgroundColor: "#F1F2F4",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background-color 0.2s ease",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "#E3E5E7")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "#F1F2F4")
                      }
                    >
                      <Icon source={PlusCircleIcon} tone="base" />
                    </div>
                    <BlockStack gap="200" align="center">
                      <Text variant="headingLg" as="h3" alignment="center">
                        Create New Test
                      </Text>
                      <Text as="p" tone="subdued" alignment="center">
                        Start testing product images to improve conversion rates
                      </Text>
                    </BlockStack>
                    <Button
                      variant="primary"
                      size="large"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCreateForm(true);
                      }}
                    >
                      Get Started
                    </Button>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

        {/* Active Test Card */}
        {data.activeTest && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  {/* Row 1: Title, Badges, and Buttons */}
                  <InlineStack align="space-between">
                    <InlineStack gap="100">
                      <Text variant="headingLg" as="h2">
                        {data.activeTest.name}
                      </Text>
                      <span
                        title={
                          data.activeTest.status === "ACTIVE"
                            ? "Test is currently running and collecting data"
                            : "Test is paused and not collecting new data"
                        }
                      >
                        <Badge
                          tone={
                            data.activeTest.status === "ACTIVE"
                              ? "success"
                              : "attention"
                          }
                        >
                          {data.activeTest.status}
                        </Badge>
                      </span>
                      <span
                        title={
                          data.activeTest.currentCase === "BASE"
                            ? "Currently showing the original/base images (control group)"
                            : "Currently showing the test/variant images"
                        }
                      >
                        <Badge
                          tone={
                            data.activeTest.currentCase === "BASE"
                              ? "info"
                              : "attention"
                          }
                        >
                          {data.activeTest.currentCase === "BASE"
                            ? "Showing: Base Case"
                            : "Showing: Test Case"}
                        </Badge>
                      </span>
                    </InlineStack>
                    <InlineStack gap="200" align="center">
                      {data.activeTest.status === "ACTIVE" ? (
                        <Button
                          onClick={() =>
                            handleAction(data.activeTest!.id, "pause")
                          }
                          loading={fetcher.state !== "idle"}
                        >
                          Pause
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() =>
                            handleAction(data.activeTest!.id, "start")
                          }
                          loading={fetcher.state !== "idle"}
                        >
                          Resume
                        </Button>
                      )}
                      <Button
                        onClick={() =>
                          handleAction(data.activeTest!.id, "rotate")
                        }
                        loading={fetcher.state !== "idle"}
                        disabled={data.activeTest.status === "PAUSED"}
                      >
                        Rotate Now
                      </Button>
                      <Button
                        icon={CheckCircleIcon}
                        onClick={() =>
                          handleAction(data.activeTest!.id, "complete")
                        }
                        loading={fetcher.state !== "idle"}
                      >
                        Complete
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {/* Row 2: Rotation Info and Tooltip */}
                  <InlineStack gap="200" align="start">
                    <Text as="p" tone="subdued">
                      Rotation: Every {formatRotationHours(data.activeTest.rotationHours)}
                      {data.activeTest.nextRotation &&
                        countdown &&
                        ` • Next rotation in: ${countdown}`}
                    </Text>
                    {data.activeTest.nextRotation && (
                      <Popover
                        active={rotationHelpActive}
                        activator={
                          <button
                            type="button"
                            onClick={() =>
                              setRotationHelpActive(!rotationHelpActive)
                            }
                            style={{
                              cursor: "help",
                              display: "inline-flex",
                              alignItems: "center",
                              background: "none",
                              border: "none",
                              padding: 0,
                              margin: 0,
                            }}
                          >
                            <Icon source={QuestionCircleIcon} tone="subdued" />
                          </button>
                        }
                        onClose={() => setRotationHelpActive(false)}
                      >
                        <div style={{ padding: "16px" }}>
                          <BlockStack gap="200">
                            <Text as="p">
                              Tests automatically rotate between Base and Test
                              cases at the specified interval to ensure fair
                              comparison.
                            </Text>
                          </BlockStack>
                        </div>
                      </Popover>
                    )}
                  </InlineStack>
                </BlockStack>

                {/* Lift Indicator */}
                {data.activeTest.statistics.lift !== 0 && (
                  <BlockStack gap="200">
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      Lift: {data.activeTest.statistics.lift >= 0 ? "+" : ""}
                      {data.activeTest.statistics.lift.toFixed(2)}%
                    </Text>
                    <ProgressBar
                      progress={Math.min(
                        Math.abs(data.activeTest.statistics.lift),
                        100,
                      )}
                      tone={
                        data.activeTest.statistics.lift > 0
                          ? "success"
                          : "critical"
                      }
                      size="medium"
                    />
                  </BlockStack>
                )}

                <Divider />

                {/* Full Statistics Table */}
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Performance Metrics",
                    "Preview",
                    "Impressions",
                    "Add to Carts",
                    "ATC Rate",
                    "Purchases",
                    "CVR",
                    "Revenue",
                  ]}
                  rows={[
                    [
                      "Base (Control)",
                      <div
                        key="base-preview"
                        style={{
                          display: "flex",
                          gap: "4px",
                          minWidth: "130px",
                        }}
                      >
                        {(() => {
                          // Try gallery images first
                          let baseImages = data.activeTest.baseImages;
                          if (typeof baseImages === "string") {
                            try {
                              baseImages = JSON.parse(baseImages);
                            } catch (e) {
                              baseImages = [];
                            }
                          }

							// If no gallery images, try variant heroes
							type ImageItem = string | { url?: string };
							const imagesToShow: ImageItem[] =
								Array.isArray(baseImages) && baseImages.length > 0
									? baseImages
									: data.activeTest.variants?.length > 0
										? data.activeTest.variants
												.filter((v: { baseHeroImage?: unknown }) => v.baseHeroImage)
												.map((v: { baseHeroImage: unknown }) => {
													const img = v.baseHeroImage;
													return typeof img === 'string' ? (JSON.parse(img) as ImageItem) : (img as ImageItem);
												})
										: [];

							if (imagesToShow.length === 0) {
								return (
									<Text as="span" tone="subdued">
										No images
									</Text>
								);
							}

							return imagesToShow
								.slice(0, 3)
								.map((img: ImageItem, idx: number) => (
                              <img
                                key={idx}
                                src={img?.url || img}
                                alt=""
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  objectFit: "cover",
                                  borderRadius: "4px",
                                  border: "1px solid #E1E3E5",
                                }}
                              />
                            ));
                        })()}
                      </div>,
                      data.activeTest.statistics.base.impressions.toString(),
                      data.activeTest.events
                        .filter(
                          (e: any) =>
                            e.activeCase === "BASE" &&
                            e.eventType === "ADD_TO_CART",
                        )
                        .length.toString(),
                      data.activeTest.statistics.base.impressions > 0
                        ? `${((data.activeTest.events.filter((e: any) => e.activeCase === "BASE" && e.eventType === "ADD_TO_CART").length / data.activeTest.statistics.base.impressions) * 100).toFixed(2)}%`
                        : "0%",
                      data.activeTest.statistics.base.conversions.toString(),
                      `${data.activeTest.statistics.base.cvr.toFixed(2)}%`,
                      `$${data.activeTest.events
                        .filter(
                          (e: any) =>
                            e.activeCase === "BASE" &&
                            e.eventType === "PURCHASE" &&
                            e.revenue,
                        )
                        .reduce(
                          (sum: number, e: any) => sum + Number(e.revenue),
                          0,
                        )
                        .toFixed(2)}`,
                    ],
                    [
                      "Test (Variant)",
                      <div
                        key="test-preview"
                        style={{
                          display: "flex",
                          gap: "4px",
                          minWidth: "130px",
                        }}
                      >
                        {(() => {
                          // Try gallery images first
                          let testImages = data.activeTest.testImages;
                          if (typeof testImages === "string") {
                            try {
                              testImages = JSON.parse(testImages);
                            } catch (e) {
                              testImages = [];
                            }
                          }

							// If no gallery images, try variant heroes
							type ImageItem = string | { url?: string };
							const imagesToShow: ImageItem[] =
								Array.isArray(testImages) && testImages.length > 0
									? testImages
									: data.activeTest.variants?.length > 0
										? data.activeTest.variants
												.filter((v: { testHeroImage?: unknown }) => v.testHeroImage)
												.map((v: { testHeroImage: unknown }) => {
													const img = v.testHeroImage;
													return typeof img === 'string' ? (JSON.parse(img) as ImageItem) : (img as ImageItem);
												})
										: [];

							if (imagesToShow.length === 0) {
								return (
									<Text as="span" tone="subdued">
										No images
									</Text>
								);
							}

							return imagesToShow
								.slice(0, 3)
								.map((img: ImageItem, idx: number) => (
                              <img
                                key={idx}
                                src={img?.url || img}
                                alt=""
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  objectFit: "cover",
                                  borderRadius: "4px",
                                  border: "1px solid #E1E3E5",
                                }}
                              />
                            ));
                        })()}
                      </div>,
                      data.activeTest.statistics.test.impressions.toString(),
                      data.activeTest.events
                        .filter(
                          (e: any) =>
                            e.activeCase === "TEST" &&
                            e.eventType === "ADD_TO_CART",
                        )
                        .length.toString(),
                      data.activeTest.statistics.test.impressions > 0
                        ? `${((data.activeTest.events.filter((e: any) => e.activeCase === "TEST" && e.eventType === "ADD_TO_CART").length / data.activeTest.statistics.test.impressions) * 100).toFixed(2)}%`
                        : "0%",
                      data.activeTest.statistics.test.conversions.toString(),
                      `${data.activeTest.statistics.test.cvr.toFixed(2)}%`,
                      `$${data.activeTest.events
                        .filter(
                          (e: any) =>
                            e.activeCase === "TEST" &&
                            e.eventType === "PURCHASE" &&
                            e.revenue,
                        )
                        .reduce(
                          (sum: number, e: any) => sum + Number(e.revenue),
                          0,
                        )
                        .toFixed(2)}`,
                    ],
                  ]}
                />

                {/* Recent Rotations */}
                {data.activeTest.rotationEvents &&
                  data.activeTest.rotationEvents.length > 0 && (
                    <>
                      <Divider />
                      <BlockStack gap="300">
                        <Text variant="headingMd" as="h3">
                          Recent Rotations
                        </Text>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text"]}
                          headings={[
                            "Time",
                            "Rotation",
                            "Triggered By",
                            "Status",
                          ]}
                          rows={data.activeTest.rotationEvents
                            .slice(0, 5)
                            .map((event: any) => [
                              new Date(event.timestamp).toLocaleString(),
                              `${event.fromCase} → ${event.toCase}`,
                              event.triggeredBy,
                              event.success ? "✓ Success" : "✗ Failed",
                            ])}
                        />
                      </BlockStack>
                    </>
                  )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Draft Tests */}
        {data.draftTests.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Draft Tests ({data.draftTests.length})
                </Text>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "Preview",
                    "Name",
                    "Status",
                    "Base Images",
                    "Test Images",
                    <div key="actions-header" style={{ textAlign: "right" }}>
                      Actions
                    </div>,
                  ]}
					rows={data.draftTests.map((test) => {
						type ImageItem = string | { url?: string };
						const testImages: ImageItem[] = Array.isArray(test.testImages) ? test.testImages : [];
						const previewImages = testImages.slice(0, 3);

						return [
							<div
								key={`preview-${test.id}`}
								style={{ display: 'flex', gap: '4px' }}
							>
								{previewImages.map((img: ImageItem, idx: number) => (
                          <img
                            key={idx}
                            src={img?.url || img || ""}
                            alt=""
                            style={{
                              width: "40px",
                              height: "40px",
                              objectFit: "cover",
                              borderRadius: "4px",
                              border: "1px solid #E1E3E5",
                            }}
                          />
                        ))}
                        {testImages.length > 3 && (
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "4px",
                              border: "1px solid #E1E3E5",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "#F6F6F7",
                              fontSize: "12px",
                              fontWeight: "600",
                              color: "#6D7175",
                            }}
                          >
                            +{testImages.length - 3}
                          </div>
                        )}
                      </div>,
                      test.name,
                      <Badge
                        key={`status-${test.id}`}
                        tone={test.status === "PAUSED" ? "attention" : "info"}
                      >
                        {test.status}
                      </Badge>,
                      Array.isArray(test.baseImages)
                        ? test.baseImages.length.toString()
                        : "0",
                      Array.isArray(test.testImages)
                        ? test.testImages.length.toString()
                        : "0",
                      <div
                        key={`draft-actions-${test.id}`}
                        style={{ display: "flex", justifyContent: "flex-end" }}
                      >
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => handleAction(test.id, "start")}
                            loading={fetcher.state !== "idle"}
                          >
                            {test.status === "PAUSED" ? "Resume" : "Start"}
                          </Button>
                          {test.status !== "DRAFT" && (
                            <Button
                              size="slim"
                              onClick={() => navigate(`/app/ab-tests/${test.id}`)}
                            >
                              View Stats
                            </Button>
                          )}
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => handleAction(test.id, "delete")}
                            loading={fetcher.state !== "idle"}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </div>,
                    ];
                  })}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Create New Test Section - Only shown when triggered */}
        {showCreateForm && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Create New Test
                  </Text>
                  <Button onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </InlineStack>
                <ABTestCreationForm
                  productId={data.productId}
                  productTitle={data.product.title}
                  onSuccess={() => {
                    setShowCreateForm(false);
                    navigate(`/app/ab-tests?productId=${data.productId}`);
                  }}
                  onCancel={() => setShowCreateForm(false)}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Completed Tests */}
        {data.completedTests.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Completed Tests ({data.completedTests.length})
                </Text>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "Preview",
                    "Name",
                    "Winner",
                    "Lift",
                    "Conversions",
                    <div
                      key="actions-header-completed"
                      style={{ textAlign: "right" }}
                    >
                      Actions
                    </div>,
                  ]}
					rows={data.completedTests.map((test) => {
						type ImageItem = string | { url?: string };
						const testImages: ImageItem[] = Array.isArray(test.testImages) ? test.testImages : [];
						const previewImages = testImages.slice(0, 3);

						return [
							<div
								key={`preview-${test.id}`}
								style={{ display: 'flex', gap: '4px' }}
							>
								{previewImages.map((img: ImageItem, idx: number) => (
                          <img
                            key={idx}
                            src={img?.url || img || ""}
                            alt=""
                            style={{
                              width: "40px",
                              height: "40px",
                              objectFit: "cover",
                              borderRadius: "4px",
                              border: "1px solid #E1E3E5",
                            }}
                          />
                        ))}
                        {testImages.length > 3 && (
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "4px",
                              border: "1px solid #E1E3E5",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "#F6F6F7",
                              fontSize: "12px",
                              fontWeight: "600",
                              color: "#6D7175",
                            }}
                          >
                            +{testImages.length - 3}
                          </div>
                        )}
                      </div>,
                      test.name,
                      test.statistics.lift > 0
                        ? "Test"
                        : test.statistics.lift < 0
                          ? "Base"
                          : "Tie",
                      `${test.statistics.lift >= 0 ? "+" : ""}${test.statistics.lift.toFixed(2)}%`,
                      `${test.statistics.base.conversions} vs ${test.statistics.test.conversions}`,
                      <div
                        key={`completed-actions-${test.id}`}
                        style={{ display: "flex", justifyContent: "flex-end" }}
                      >
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => navigate(`/app/ab-tests/${test.id}`)}
                          >
                            View Stats
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => handleAction(test.id, "delete")}
                            loading={fetcher.state !== "idle"}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </div>,
                    ];
                  })}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Complete Confirmation Modal */}
      <Modal
        open={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        title="Complete Test"
        primaryAction={{
          content: "Complete",
          onAction: handleCompleteConfirm,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowCompleteModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to complete this test? This action cannot be
            undone and will stop the test from collecting new data.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
