import { useState, useEffect } from 'react';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData, useSearchParams, useFetcher, useNavigate } from '@remix-run/react';
import { Page, BlockStack, Layout, Modal, Text } from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db, { lookupShopId } from '../db.server';
import { AIStudioMediaService } from '../services/ai-studio-media.server';
import { checkAIProviderHealth } from '../services/ai-providers.server';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { MediaGalleryService } from '../services/media-gallery.server';
import { AuditService } from '../services/audit.server';

// AI Studio handlers
import { handleGenerate } from '../features/ai-studio/handlers/generation.server';
import {
  handleSaveToLibrary,
  handleDeleteFromLibrary,
  handleUpload,
  handleGetStagedUpload,
  handleCompleteUpload,
} from '../features/ai-studio/handlers/library.server';
import { handlePublish, handleDeleteFromProduct } from '../features/ai-studio/handlers/product-media.server';
import { handlePublishWithVariants } from '../features/ai-studio/handlers/variant-media.server';

// Components
import { ProductHubTabs, HomeTabContent, CreateTestCard } from '../features/products/components';
import { ImageGenerationHub } from '../features/ai-studio/components/ImageGenerationHub';
import { ImagePreviewModal } from '../features/ai-studio/components/ImagePreviewModal';
import { ABTestCreationForm } from '../features/ab-testing/components';
import { useAuthenticatedAppFetch } from '../hooks/useAuthenticatedAppFetch';

// Types
import type { TabType, LibraryItem, ABTestWithStats, ProductStats } from '../features/products/types';
import type {
  GeneratedImage,
  SelectedImage,
  BatchProcessingState,
  ActionErrorResponse,
} from '../features/ai-studio/types';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = params.productId;

  if (!productId) {
    return redirect('/app');
  }

  // Decode the productId if it's URL encoded
  const decodedProductId = decodeURIComponent(productId);

  const url = new URL(request.url);
  const tabParam = url.searchParams.get('tab');
  const currentTab: TabType = (tabParam === 'images' || tabParam === 'tests') ? tabParam : 'home';

  // Fetch product with media and variants
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
        variants(first: 100) {
          nodes {
            id
            title
            displayName
            sku
            selectedOptions {
              name
              value
            }
            image {
              url
              altText
            }
          }
        }
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
    { variables: { id: decodedProductId } },
  );

  const responseJson = await response.json();
  const product = responseJson.data?.product;

  if (!product) {
    throw new Response('Product not found', { status: 404 });
  }

  const shopId = await lookupShopId(session.shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${session.shop}`);
  }

  // Fetch library items from database
  const aiStudioMediaService = new AIStudioMediaService(admin, db);

  // Migrate metafield data if exists
  const metafieldValue = product.metafield?.value;
  if (metafieldValue) {
    await aiStudioMediaService.migrateFromMetafield(session.shop, decodedProductId, metafieldValue, shopId);
  }

  // Get library items
  const dbImages = await aiStudioMediaService.getLibraryImages(session.shop, decodedProductId, undefined, shopId);
  const libraryItems: LibraryItem[] = dbImages.map(img => ({
    imageUrl: img.url,
    sourceUrl: img.sourceImageUrl,
    variantIds: img.variantIds,
  }));

  // Fetch all tests for this product
  const tests = await db.aBTest.findMany({
    where: {
      shopId,
      productId: decodedProductId,
    },
    include: {
      variants: true,
      events: {
        take: 1000,
      },
      rotationEvents: {
        take: 20,
        orderBy: { timestamp: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate statistics for each test
  const testsWithStats: ABTestWithStats[] = tests.map((test) => {
    const baseEvents = test.events.filter((e) => e.activeCase === 'BASE');
    const testEvents = test.events.filter((e) => e.activeCase === 'TEST');

    const baseImpressions = baseEvents.filter((e) => e.eventType === 'IMPRESSION').length;
    const testImpressions = testEvents.filter((e) => e.eventType === 'IMPRESSION').length;
    const baseConversions = baseEvents.filter((e) => e.eventType === 'PURCHASE').length;
    const testConversions = testEvents.filter((e) => e.eventType === 'PURCHASE').length;
    const baseAddToCarts = baseEvents.filter((e) => e.eventType === 'ADD_TO_CART').length;
    const testAddToCarts = testEvents.filter((e) => e.eventType === 'ADD_TO_CART').length;

    // Calculate revenue
    const baseRevenue = baseEvents
      .filter((e) => e.eventType === 'PURCHASE')
      .reduce((sum, e) => sum + (e.value || 0), 0);
    const testRevenue = testEvents
      .filter((e) => e.eventType === 'PURCHASE')
      .reduce((sum, e) => sum + (e.value || 0), 0);

    const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
    const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;
    const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

    return {
      id: test.id,
      name: test.name,
      productId: test.productId,
      shopId: test.shopId,
      status: test.status as ABTestWithStats['status'],
      currentCase: test.currentCase as ABTestWithStats['currentCase'],
      rotationHours: test.rotationHours,
      nextRotation: test.nextRotation?.toISOString(),
      baseImages: test.baseImages as string | string[],
      testImages: test.testImages as string | string[],
      baseMediaIds: test.baseMediaIds as string[] | undefined,
      testMediaIds: test.testMediaIds as string[] | undefined,
      createdAt: test.createdAt.toISOString(),
      updatedAt: test.updatedAt.toISOString(),
      completedAt: test.completedAt?.toISOString(),
      statistics: {
        base: {
          impressions: baseImpressions,
          conversions: baseConversions,
          cvr: baseCVR,
          addToCarts: baseAddToCarts,
          revenue: baseRevenue,
        },
        test: {
          impressions: testImpressions,
          conversions: testConversions,
          cvr: testCVR,
          addToCarts: testAddToCarts,
          revenue: testRevenue,
        },
        lift,
      },
      variants: test.variants,
      rotationEvents: test.rotationEvents,
    };
  });

  // Calculate product-level stats (aggregate from all tests)
  const allEvents = tests.flatMap(t => t.events);
  const productStats: ProductStats = {
    impressions: allEvents.filter(e => e.eventType === 'IMPRESSION').length,
    addToCarts: allEvents.filter(e => e.eventType === 'ADD_TO_CART').length,
    purchases: allEvents.filter(e => e.eventType === 'PURCHASE').length,
    revenue: allEvents
      .filter(e => e.eventType === 'PURCHASE')
      .reduce((sum, e) => sum + (e.value || 0), 0),
    cvr: 0,
    atcRate: 0,
  };

  if (productStats.impressions > 0) {
    productStats.cvr = (productStats.purchases / productStats.impressions) * 100;
    productStats.atcRate = (productStats.addToCarts / productStats.impressions) * 100;
  }

  const activeTest = testsWithStats.find(t => t.status === 'ACTIVE' || t.status === 'PAUSED') || null;
  const draftTests = testsWithStats.filter(t => t.status === 'DRAFT');
  const completedTests = testsWithStats.filter(t => t.status === 'COMPLETED');

  return json({
    product,
    productId: decodedProductId,
    shop: session.shop,
    libraryItems,
    tests: testsWithStats,
    activeTest,
    draftTests,
    completedTests,
    productStats,
    currentTab,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, shopId } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');
  const productId = params.productId ? decodeURIComponent(params.productId) : '';

  // Ensure productId is set in formData for handlers that need it
  if (!formData.get('productId') && productId) {
    formData.set('productId', productId);
  }

  try {
    // Route to appropriate handler based on intent
    switch (intent) {
      // AI Studio intents
      case 'publish':
        return handlePublish(formData, admin, session.shop);

      case 'publishWithVariants':
        return handlePublishWithVariants(formData, admin, session.shop);

      case 'deleteFromProduct':
        return handleDeleteFromProduct(formData, admin, session.shop);

      case 'saveToLibrary':
        return handleSaveToLibrary(formData, admin, session.shop);

      case 'deleteFromLibrary':
        return handleDeleteFromLibrary(formData, admin, session.shop);

      case 'upload':
        return handleUpload(formData, admin, session.shop);

      case 'getStagedUpload':
        return handleGetStagedUpload(formData, admin, session.shop);

      case 'completeUpload':
        return handleCompleteUpload(formData, admin, session.shop);

      case 'generate': {
        const healthCheck = checkAIProviderHealth();
        if (!healthCheck.healthy) {
          const errorResponse: ActionErrorResponse = {
            ok: false,
            error: `AI service unavailable: ${healthCheck.error}`,
          };
          return json(errorResponse, { status: 503 });
        }
        return handleGenerate(formData, session.shop, admin);
      }

      // A/B Tests intents - import handlers from ab-tests route
      case 'create':
      case 'start':
      case 'pause':
      case 'complete':
      case 'delete':
      case 'rotate': {
        // For A/B test actions, we'll redirect to the main ab-tests route action
        // This keeps all A/B test logic in one place
        const response = await fetch(new URL('/app/ab-tests', request.url).toString(), {
          method: 'POST',
          headers: request.headers,
          body: formData,
        });
        return response;
      }

      default:
        return json({ ok: false, error: 'Unknown intent' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[product-hub action] Error:', error);
    return json(
      { ok: false, error: error.message || 'An error occurred' },
      { status: 500 }
    );
  }
};

export default function ProductHub() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const authenticatedAppFetch = useAuthenticatedAppFetch();

  // State for Images tab
  const variants = (data.product?.variants?.nodes || []) as any[];
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [batchProcessingState, setBatchProcessingState] = useState<BatchProcessingState>({
    isProcessing: false,
    currentIndex: 0,
    totalImages: 0,
    completedImages: [],
    failedImages: [],
  });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewBase, setPreviewBase] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>(data.libraryItems || []);
  const [pendingAction, setPendingAction] = useState<null | string>(null);
  const [libraryItemToDelete, setLibraryItemToDelete] = useState<string | null>(null);

  // State for Tests tab
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Update library items when data changes
  useEffect(() => {
    setLibraryItems(data.libraryItems || []);
  }, [data.libraryItems]);

  // Handle image selection
  const handleImageSelect = (image: SelectedImage) => {
    setSelectedImages(prev => {
      const isAlreadySelected = prev.some(img => img.url === image.url);
      if (isAlreadySelected) {
        return prev.filter(img => img.url !== image.url);
      } else {
        return [...prev, image];
      }
    });
  };

  const handleClearSelection = () => {
    setSelectedImages([]);
  };

  // Handle batch generation (same as ai-studio)
  const handleGenerate = async (prompt: string, aspectRatio: string, imageCount: number = 1) => {
    if (selectedImages.length === 0 || !prompt.trim()) {
      shopify.toast.show('Please select at least one image and enter a model description', { isError: true });
      return;
    }

    const totalImages = selectedImages.length * imageCount;
    setBatchProcessingState({
      isProcessing: true,
      currentIndex: 0,
      totalImages,
      completedImages: [],
      failedImages: [],
    });
    setPendingAction('generate');

    const generationTasks = [];
    let globalIndex = 0;

    for (let i = 0; i < selectedImages.length; i++) {
      const image = selectedImages[i];
      for (let j = 0; j < imageCount; j++) {
        const currentGlobalIndex = globalIndex;
        const task = (async () => {
          try {
            const fd = new FormData();
            fd.set('sourceImageUrl', image.url);
            fd.set('prompt', prompt);
            fd.set('productId', data.product?.id || '');
            fd.set('aspectRatio', aspectRatio);

            const response = await authenticatedAppFetch('/app/api/generate', {
              method: 'POST',
              body: fd,
            });

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              throw new Error(`Server error (${response.status}). Please try again.`);
            }

            const result = await response.json();

            if (result.ok && result.result) {
              const generatedImage: GeneratedImage = {
                id: result.result.id || `batch_${Date.now()}_${currentGlobalIndex}`,
                imageUrl: result.result.imageUrl,
                confidence: result.result.confidence || 0.9,
                metadata: {
                  ...result.result.metadata,
                  sourceImage: image,
                  prompt,
                  batchIndex: currentGlobalIndex + 1,
                  batchTotal: totalImages,
                },
              };

              setBatchProcessingState(prev => ({
                ...prev,
                completedImages: [...prev.completedImages, generatedImage],
              }));
              setGeneratedImages(prev => [...prev, generatedImage]);
              return { success: true, image: generatedImage };
            } else {
              const error = result.error || 'Unknown error';
              setBatchProcessingState(prev => ({
                ...prev,
                failedImages: [...prev.failedImages, { imageUrl: image.url, error }],
              }));
              return { success: false, error };
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Network error';
            setBatchProcessingState(prev => ({
              ...prev,
              failedImages: [...prev.failedImages, { imageUrl: image.url, error: errorMessage }],
            }));
            return { success: false, error: errorMessage };
          }
        })();

        generationTasks.push(task);
        globalIndex++;
      }
    }

    await Promise.all(generationTasks);

    setBatchProcessingState(prev => {
      const completedCount = prev.completedImages.length;
      const failedCount = prev.failedImages.length;

      if (failedCount === 0) {
        shopify.toast.show(`Successfully generated ${completedCount} AI images!`);
      } else if (completedCount > 0) {
        shopify.toast.show(`Generated ${completedCount} images, ${failedCount} failed`);
      } else {
        const firstError = prev.failedImages[0]?.error || 'Failed to generate images';
        shopify.toast.show(firstError, { isError: true });
      }

      return { ...prev, isProcessing: false };
    });

    setPendingAction(null);
  };

  // Handle fetcher responses
  useEffect(() => {
    const fetcherData = fetcher.data as any;
    if (fetcherData?.ok && pendingAction === 'publish') {
      shopify.toast.show('Published to product');
      setPendingAction(null);
    } else if (fetcherData?.ok && pendingAction === 'saveToLibrary') {
      if (fetcherData.duplicate) {
        shopify.toast.show('Item already in library');
      } else {
        shopify.toast.show('Saved to library');
      }
      setPendingAction(null);
    } else if (fetcherData?.ok && pendingAction === 'deleteFromLibrary') {
      shopify.toast.show('Removed from library');
      setLibraryItemToDelete(null);
      setPendingAction(null);
    } else if (fetcherData && !fetcherData.ok && fetcherData.error) {
      shopify.toast.show(String(fetcherData.error), { isError: true });
      setPendingAction(null);
    }

    // Handle A/B test actions
    if (fetcherData?.success && fetcherData.message) {
      shopify.toast.show(fetcherData.message);
    } else if (fetcherData?.success === false && fetcherData.error) {
      shopify.toast.show(fetcherData.error, { isError: true });
    }
  }, [fetcher.data, pendingAction, shopify]);

  const handlePublishImage = (image: any) => {
    const fd = new FormData();
    fd.set('intent', 'publish');
    fd.set('imageUrl', image.imageUrl);
    fd.set('productId', data.product?.id || '');
    setPendingAction('publish');
    fetcher.submit(fd, { method: 'post' });
  };

  const handlePublishFromLibrary = (url: string) => {
    const fd = new FormData();
    fd.set('intent', 'publish');
    fd.set('imageUrl', url);
    fd.set('productId', data.product?.id || '');
    setPendingAction('publish');
    fetcher.submit(fd, { method: 'post' });
  };

  const handleCreateTest = () => {
    // Navigate to tests tab and show create form
    navigate(`/app/products/${encodeURIComponent(data.productId)}?tab=tests`);
    setShowCreateForm(true);
  };

  // Render based on current tab
  const renderTabContent = () => {
    switch (data.currentTab) {
      case 'home':
        return (
          <HomeTabContent
            productId={data.productId}
            productStats={data.productStats}
            tests={data.tests}
            onCreateTest={handleCreateTest}
          />
        );

      case 'images':
        return (
          <BlockStack gap="300">
            {previewImage && (
              <ImagePreviewModal
                url={previewImage}
                baseUrl={previewBase}
                onClose={() => setPreviewImage(null)}
              />
            )}

            {libraryItemToDelete && (
              <Modal
                open
                onClose={() => setLibraryItemToDelete(null)}
                title="Remove from library?"
                primaryAction={{
                  content: 'Delete',
                  destructive: true,
                  onAction: () => {
                    const fd = new FormData();
                    fd.set('intent', 'deleteFromLibrary');
                    fd.set('imageUrl', libraryItemToDelete);
                    fd.set('productId', data.product?.id || '');
                    setPendingAction('deleteFromLibrary');
                    fetcher.submit(fd, { method: 'post' });
                  },
                }}
                secondaryActions={[
                  { content: 'Cancel', onAction: () => setLibraryItemToDelete(null) },
                ]}
              >
                <BlockStack gap="200">
                  <Text as="p">This will permanently remove the image from your library.</Text>
                </BlockStack>
              </Modal>
            )}

            <ImageGenerationHub
              productId={data.product.id}
              media={data.product.media?.nodes || []}
              selectedImages={selectedImages}
              generatedImages={generatedImages}
              libraryItems={libraryItems}
              batchProcessingState={batchProcessingState}
              onImageSelect={handleImageSelect}
              onClearSelection={handleClearSelection}
              onGenerate={handleGenerate}
              onPublish={handlePublishImage}
              onSaveToLibrary={(img) => {
                const fd = new FormData();
                fd.set('intent', 'saveToLibrary');
                fd.set('imageUrl', img.imageUrl);
                fd.set('source', 'AI_GENERATED');
                const sourceUrl = img.metadata?.sourceImage?.url || (selectedImages[0]?.url || '');
                fd.set('sourceUrl', sourceUrl);
                fd.set('productId', data.product?.id || '');
                if (img.metadata?.prompt) {
                  fd.set('prompt', img.metadata.prompt);
                }
                setPendingAction('saveToLibrary');
                fetcher.submit(fd, { method: 'post' });
              }}
              onPreview={(img) => {
                setPreviewImage(img.imageUrl);
                const baseUrl = img.metadata?.sourceImage?.url || selectedImages[0]?.url || null;
                setPreviewBase(baseUrl);
              }}
              onPublishFromLibrary={handlePublishFromLibrary}
              onPreviewLibrary={(url, base) => {
                setPreviewImage(url);
                setPreviewBase(base || null);
              }}
              onRemoveFromLibrary={(url) => setLibraryItemToDelete(url)}
              onUploadSuccess={(imageUrls) => {
                const newLibraryItems = imageUrls.map(url => ({
                  imageUrl: url,
                  sourceUrl: null,
                }));
                setLibraryItems(prev => [...newLibraryItems, ...prev]);
                shopify.toast.show(`Successfully uploaded ${imageUrls.length} image${imageUrls.length > 1 ? 's' : ''}!`);
              }}
              isBusy={pendingAction === 'publish' || pendingAction === 'saveToLibrary'}
              pendingAction={pendingAction}
            />
          </BlockStack>
        );

      case 'tests':
        return (
          <Layout>
            {/* Show create form or test list based on state */}
            {showCreateForm ? (
              <Layout.Section>
                <ABTestCreationForm
                  productId={data.productId}
                  productTitle={data.product.title}
                  shop={data.shop}
                  onSuccess={() => {
                    setShowCreateForm(false);
                    shopify.toast.show('Test created successfully!');
                  }}
                  onCancel={() => setShowCreateForm(false)}
                />
              </Layout.Section>
            ) : !data.activeTest && data.draftTests.length === 0 ? (
              <Layout.Section>
                <CreateTestCard onCreateTest={() => setShowCreateForm(true)} />
              </Layout.Section>
            ) : (
              <>
                {/* Active test and management UI from ab-tests route */}
                <Layout.Section>
                  <BlockStack gap="400">
                    {data.activeTest && (
                      <Text as="p">Active test management coming soon. View full details in A/B Tests section.</Text>
                    )}
                    {data.draftTests.length > 0 && (
                      <Text as="p">{data.draftTests.length} draft test(s) available.</Text>
                    )}
                    <button
                      onClick={() => setShowCreateForm(true)}
                      style={{
                        background: '#008060',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '10px 20px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                      }}
                    >
                      + Create New Test
                    </button>
                  </BlockStack>
                </Layout.Section>
              </>
            )}
          </Layout>
        );

      default:
        return null;
    }
  };

  return (
    <Page fullWidth>
      <TitleBar title={data.product.title}>
        <button
          onClick={() => {
            const productNumericId = data.product.id.replace('gid://shopify/Product/', '');
            window.open(`shopify:admin/products/${productNumericId}`, '_blank');
          }}
        >
          View Product
        </button>
        <button
          onClick={() => {
            window.open(`https://${data.shop}/products/${data.product.handle}`, '_blank');
          }}
        >
          View in Store
        </button>
      </TitleBar>

      <ProductHubTabs
        productId={data.productId}
        currentTab={data.currentTab}
        imageCount={libraryItems.length}
        activeTestCount={data.activeTest ? 1 : 0}
        testCount={data.tests.length}
      />

      {renderTabContent()}
    </Page>
  );
}
