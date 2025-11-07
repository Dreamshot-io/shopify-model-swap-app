import { useState, useEffect } from 'react';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher, useNavigate } from '@remix-run/react';
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Banner,
  Text,
  Button,
  InlineStack,
  Badge,
  DataTable,
  ProgressBar,
  Divider,
} from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { AuditService } from '../services/audit.server';
import { ProductSelector } from '../features/shared/components';
import { ABTestCreationForm } from '../features/ab-testing/components';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');

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
      `
    );

    const productsData = await productsResponse.json();
    const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

    // Get test counts per product for badges
    const tests = await db.aBTest.findMany({
      where: { shop: session.shop },
      select: { productId: true, status: true },
    });

    const testCounts: Record<string, { count: number; hasActive: boolean }> = {};
    tests.forEach((test) => {
      if (!testCounts[test.productId]) {
        testCounts[test.productId] = { count: 0, hasActive: false };
      }
      testCounts[test.productId].count++;
      if (test.status === 'ACTIVE') {
        testCounts[test.productId].hasActive = true;
      }
    });

    return json({
      view: 'productSelection' as const,
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
    { variables: { id: productId } }
  );

  const productData = await productResponse.json();
  const product = productData.data?.product;
  const shop = session.shop;

  if (!product) {
    throw new Response('Product not found', { status: 404 });
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
        orderBy: { timestamp: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate statistics for each test
  const testsWithStats = tests.map((test) => {
    const baseEvents = test.events.filter((e) => e.activeCase === 'BASE');
    const testEvents = test.events.filter((e) => e.activeCase === 'TEST');

    const baseImpressions = baseEvents.filter((e) => e.eventType === 'IMPRESSION').length;
    const testImpressions = testEvents.filter((e) => e.eventType === 'IMPRESSION').length;

    const baseConversions = baseEvents.filter((e) => e.eventType === 'PURCHASE').length;
    const testConversions = testEvents.filter((e) => e.eventType === 'PURCHASE').length;

    const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
    const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;
    const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

    return {
      ...test,
      statistics: {
        base: { impressions: baseImpressions, conversions: baseConversions, cvr: baseCVR },
        test: { impressions: testImpressions, conversions: testConversions, cvr: testCVR },
        lift,
      },
    };
  });

  const activeTest = testsWithStats.find((t) => t.status === 'ACTIVE' || t.status === 'PAUSED');
  const draftTests = testsWithStats.filter((t) => t.status === 'DRAFT');
  const completedTests = testsWithStats.filter((t) => t.status === 'COMPLETED');

  return json({
    view: 'productTests' as const,
    product,
    productId,
    shop,
    tests: testsWithStats,
    activeTest,
    draftTests,
    completedTests,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  try {
    switch (intent) {
      case 'create': {
        const name = formData.get('name') as string;
        const productId = formData.get('productId') as string;
        const testImagesJson = formData.get('testImages') as string;
        const variantTestsJson = formData.get('variantTests') as string;

        if (!name || !productId) {
          return json({ success: false, error: 'Missing required fields' }, { status: 400 });
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
            variantTests = JSON.parse(variantTestsJson);
          } catch (e) {
            variantTests = [];
          }
        }

        // Must have at least gallery images OR variant tests
        if (testImages.length === 0 && variantTests.length === 0) {
          return json({ success: false, error: 'Select at least gallery images or variant heroes' }, { status: 400 });
        }

        // Capture base images
        const baseImages = testImages.length > 0
          ? await SimpleRotationService.captureBaseImages(admin, productId)
          : [];

        // Capture base variant heroes if testing variants
        let baseHeroImages = new Map();
        if (variantTests.length > 0) {
          const variantIds = variantTests.map((v: any) => v.variantId);
          baseHeroImages = await SimpleRotationService.captureVariantHeroImages(
            admin,
            productId,
            variantIds
          );
        }

        // Create the test (hardcoded to 24 hour rotation)
        const test = await db.aBTest.create({
          data: {
            shop: session.shop,
            productId,
            name,
            status: 'DRAFT',
            trafficSplit: 50,
            baseImages: baseImages,
            testImages: testImages,
            currentCase: 'BASE',
            rotationHours: 24, // Default 24 hours
            createdBy: session.id,
          },
        });

        // Create variant test records if any
        for (const variantTest of variantTests) {
          const baseHero = baseHeroImages.get(variantTest.variantId);
          await db.aBTestVariant.create({
            data: {
              testId: test.id,
              shopifyVariantId: variantTest.variantId,
              variantName: variantTest.variantName,
              baseHeroImage: baseHero || null,
              testHeroImage: {
                url: variantTest.heroImage.url,
                position: 0,
              },
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

      case 'start': {
        const testId = formData.get('testId') as string;
        await SimpleRotationService.startTest(testId, session.id);
        return json({ success: true, message: 'Test started' });
      }

      case 'pause': {
        const testId = formData.get('testId') as string;
        await SimpleRotationService.pauseTest(testId, session.id, admin);
        return json({ success: true, message: 'Test paused and restored to base case' });
      }

      case 'complete': {
        const testId = formData.get('testId') as string;
        await SimpleRotationService.completeTest(testId, admin, session.id);
        return json({ success: true, message: 'Test completed' });
      }

      case 'delete': {
        const testId = formData.get('testId') as string;
        const test = await db.aBTest.findUnique({ where: { id: testId } });

        if (test) {
          await AuditService.logTestDeleted(testId, test.name, session.shop, session.id);
          await db.aBTest.delete({ where: { id: testId } });
        }

        return json({ success: true, message: 'Test deleted' });
      }

      case 'rotate': {
        const testId = formData.get('testId') as string;
        const result = await SimpleRotationService.rotateTest(testId, 'MANUAL', session.id, admin);
        return json({ success: true, message: 'Rotation completed', result });
      }

      default:
        return json({ success: false, error: 'Unknown intent' }, { status: 400 });
    }
  } catch (error) {
    console.error('Action error:', error);
    return json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
};

export default function ABTests() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Show toast on success or error
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.success === false && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  // STATE 1: Product Selection
  if (data.view === 'productSelection') {
    const badgeData: Record<string, { count: number; tone: 'success' | 'info' }> = {};
    Object.entries(data.testCounts).forEach(([productId, info]) => {
      badgeData[productId] = {
        count: info.count,
        tone: info.hasActive ? 'success' : 'info',
      };
    });

    return (
      <Page>
        <TitleBar title="A/B Tests" />
        <ProductSelector
          products={data.products}
          onSelectProduct={(id) => navigate(`/app/ab-tests?productId=${encodeURIComponent(id)}`)}
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
    fetcher.submit(
      { testId, intent },
      { method: 'post' }
    );
  };

  return (
    <Page
      fullWidth
      backAction={{
        content: 'Products',
        onAction: () => navigate('/app/ab-tests'),
      }}
    >
      <TitleBar title={`A/B Tests - ${data.product.title}`}>
        <button
          onClick={() => {
            const productNumericId = data.productId.replace('gid://shopify/Product/', '');
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
        <button
          variant="primary"
          onClick={() => setShowCreateForm(true)}
        >
          + Create New Test
        </button>
      </TitleBar>

      <Layout>
        {/* Active Test Card */}
        {data.activeTest && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <BlockStack gap="200">
                    <InlineStack gap="200">
                      <Text variant="headingLg" as="h2">
                        {data.activeTest.name}
                      </Text>
                      <Badge tone={data.activeTest.status === 'ACTIVE' ? 'success' : 'attention'}>
                        {data.activeTest.status}
                      </Badge>
                      <Badge tone={data.activeTest.currentCase === 'BASE' ? 'info' : 'attention'}>
                        {data.activeTest.currentCase}
                      </Badge>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      Rotation: Every {data.activeTest.rotationHours} hours
                      {data.activeTest.nextRotation &&
                        ` • Next: ${new Date(data.activeTest.nextRotation).toLocaleString()}`
                      }
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    {data.activeTest.status === 'ACTIVE' ? (
                      <Button
                        size="slim"
                        onClick={() => handleAction(data.activeTest!.id, 'pause')}
                        loading={fetcher.state !== 'idle'}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="slim"
                        onClick={() => handleAction(data.activeTest!.id, 'start')}
                        loading={fetcher.state !== 'idle'}
                      >
                        Resume
                      </Button>
                    )}
                    <Button
                      size="slim"
                      onClick={() => handleAction(data.activeTest!.id, 'rotate')}
                      loading={fetcher.state !== 'idle'}
                      disabled={data.activeTest.status === 'PAUSED'}
                    >
                      Rotate Now
                    </Button>
                    <Button
                      size="slim"
                      tone="critical"
                      onClick={() => handleAction(data.activeTest!.id, 'complete')}
                      loading={fetcher.state !== 'idle'}
                    >
                      Complete
                    </Button>
                  </InlineStack>
                </InlineStack>

                {/* Lift Indicator */}
                {data.activeTest.statistics.lift !== 0 && (
                  <BlockStack gap="200">
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      Lift: {data.activeTest.statistics.lift >= 0 ? '+' : ''}
                      {data.activeTest.statistics.lift.toFixed(2)}%
                    </Text>
                    <ProgressBar
                      progress={Math.min(Math.abs(data.activeTest.statistics.lift), 100)}
                      tone={data.activeTest.statistics.lift > 0 ? 'success' : 'critical'}
                      size="medium"
                    />
                  </BlockStack>
                )}

                <Divider />

                {/* Full Statistics Table */}
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h3">
                    Performance Metrics
                  </Text>
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                    headings={['', 'Preview', 'Impressions', 'Add to Carts', 'ATC Rate', 'Purchases', 'CVR', 'Revenue']}
                    rows={[
                      [
                        'Base (Control)',
                        <div key="base-preview" style={{ display: 'flex', gap: '4px', minWidth: '130px' }}>
                          {(() => {
                            // Try gallery images first
                            let baseImages = data.activeTest.baseImages;
                            if (typeof baseImages === 'string') {
                              try { baseImages = JSON.parse(baseImages); } catch (e) { baseImages = []; }
                            }

                            // If no gallery images, try variant heroes
                            const imagesToShow = Array.isArray(baseImages) && baseImages.length > 0
                              ? baseImages
                              : data.activeTest.variants?.length > 0
                                ? data.activeTest.variants
                                    .filter((v: any) => v.baseHeroImage)
                                    .map((v: any) => {
                                      const img = v.baseHeroImage;
                                      return typeof img === 'string' ? JSON.parse(img) : img;
                                    })
                                : [];

                            if ((imagesToShow as any[]).length === 0) {
                              return <Text as="span" tone="subdued">No images</Text>;
                            }

                            return (imagesToShow as any[]).slice(0, 3).map((img: any, idx: number) => (
                              <img
                                key={idx}
                                src={img?.url || img}
                                alt=""
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  objectFit: 'cover',
                                  borderRadius: '4px',
                                  border: '1px solid #E1E3E5',
                                }}
                              />
                            ));
                          })()}
                        </div>,
                        data.activeTest.statistics.base.impressions.toString(),
                        data.activeTest.events.filter((e: any) => e.activeCase === 'BASE' && e.eventType === 'ADD_TO_CART').length.toString(),
                        data.activeTest.statistics.base.impressions > 0
                          ? `${((data.activeTest.events.filter((e: any) => e.activeCase === 'BASE' && e.eventType === 'ADD_TO_CART').length / data.activeTest.statistics.base.impressions) * 100).toFixed(2)}%`
                          : '0%',
                        data.activeTest.statistics.base.conversions.toString(),
                        `${data.activeTest.statistics.base.cvr.toFixed(2)}%`,
                        `$${data.activeTest.events
                          .filter((e: any) => e.activeCase === 'BASE' && e.eventType === 'PURCHASE' && e.revenue)
                          .reduce((sum: number, e: any) => sum + Number(e.revenue), 0)
                          .toFixed(2)}`,
                      ],
                      [
                        'Test (Variant)',
                        <div key="test-preview" style={{ display: 'flex', gap: '4px', minWidth: '130px' }}>
                          {(() => {
                            // Try gallery images first
                            let testImages = data.activeTest.testImages;
                            if (typeof testImages === 'string') {
                              try { testImages = JSON.parse(testImages); } catch (e) { testImages = []; }
                            }

                            // If no gallery images, try variant heroes
                            const imagesToShow = Array.isArray(testImages) && testImages.length > 0
                              ? testImages
                              : data.activeTest.variants?.length > 0
                                ? data.activeTest.variants
                                    .filter((v: any) => v.testHeroImage)
                                    .map((v: any) => {
                                      const img = v.testHeroImage;
                                      return typeof img === 'string' ? JSON.parse(img) : img;
                                    })
                                : [];

                            if ((imagesToShow as any[]).length === 0) {
                              return <Text as="span" tone="subdued">No images</Text>;
                            }

                            return (imagesToShow as any[]).slice(0, 3).map((img: any, idx: number) => (
                              <img
                                key={idx}
                                src={img?.url || img}
                                alt=""
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  objectFit: 'cover',
                                  borderRadius: '4px',
                                  border: '1px solid #E1E3E5',
                                }}
                              />
                            ));
                          })()}
                        </div>,
                        data.activeTest.statistics.test.impressions.toString(),
                        data.activeTest.events.filter((e: any) => e.activeCase === 'TEST' && e.eventType === 'ADD_TO_CART').length.toString(),
                        data.activeTest.statistics.test.impressions > 0
                          ? `${((data.activeTest.events.filter((e: any) => e.activeCase === 'TEST' && e.eventType === 'ADD_TO_CART').length / data.activeTest.statistics.test.impressions) * 100).toFixed(2)}%`
                          : '0%',
                        data.activeTest.statistics.test.conversions.toString(),
                        `${data.activeTest.statistics.test.cvr.toFixed(2)}%`,
                        `$${data.activeTest.events
                          .filter((e: any) => e.activeCase === 'TEST' && e.eventType === 'PURCHASE' && e.revenue)
                          .reduce((sum: number, e: any) => sum + Number(e.revenue), 0)
                          .toFixed(2)}`,
                      ],
                    ]}
                  />
                </BlockStack>

                {/* Recent Rotations */}
                {data.activeTest.rotationEvents && data.activeTest.rotationEvents.length > 0 && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h3">
                        Recent Rotations
                      </Text>
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text']}
                        headings={['Time', 'Rotation', 'Triggered By', 'Status']}
                        rows={data.activeTest.rotationEvents.slice(0, 5).map((event: any) => [
                          new Date(event.timestamp).toLocaleString(),
                          `${event.fromCase} → ${event.toCase}`,
                          event.triggeredBy,
                          event.success ? '✓ Success' : '✗ Failed',
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
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'text']}
                  headings={['Preview', 'Name', 'Status', 'Base Images', 'Test Images', <div key="actions-header" style={{ textAlign: 'right' }}>Actions</div>]}
                  rows={data.draftTests.map((test) => {
                    const testImages = Array.isArray(test.testImages) ? test.testImages as any[] : [];
                    const previewImages = testImages.slice(0, 3);

                    return [
                      <div key={`preview-${test.id}`} style={{ display: 'flex', gap: '4px' }}>
                        {previewImages.map((img: any, idx: number) => (
                          <img
                            key={idx}
                            src={img.url}
                            alt=""
                            style={{
                              width: '40px',
                              height: '40px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid #E1E3E5',
                            }}
                          />
                        ))}
                        {testImages.length > 3 && (
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '4px',
                              border: '1px solid #E1E3E5',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#F6F6F7',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#6D7175',
                            }}
                          >
                            +{testImages.length - 3}
                          </div>
                        )}
                      </div>,
                      test.name,
                      <Badge key={`status-${test.id}`} tone={test.status === 'PAUSED' ? 'attention' : 'info'}>
                        {test.status}
                      </Badge>,
                      Array.isArray(test.baseImages) ? test.baseImages.length.toString() : '0',
                      Array.isArray(test.testImages) ? test.testImages.length.toString() : '0',
                      <div key={`draft-actions-${test.id}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => handleAction(test.id, 'start')}
                            loading={fetcher.state !== 'idle'}
                          >
                            {test.status === 'PAUSED' ? 'Resume' : 'Start'}
                          </Button>
                          <Button
                            size="slim"
                            url={`/app/ab-tests/${test.id}`}
                          >
                            View Stats
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => handleAction(test.id, 'delete')}
                            loading={fetcher.state !== 'idle'}
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
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'text']}
                  headings={['Preview', 'Name', 'Winner', 'Lift', 'Conversions', <div key="actions-header-completed" style={{ textAlign: 'right' }}>Actions</div>]}
                  rows={data.completedTests.map((test) => {
                    const testImages = Array.isArray(test.testImages) ? test.testImages as any[] : [];
                    const previewImages = testImages.slice(0, 3);

                    return [
                      <div key={`preview-${test.id}`} style={{ display: 'flex', gap: '4px' }}>
                        {previewImages.map((img: any, idx: number) => (
                          <img
                            key={idx}
                            src={img.url}
                            alt=""
                            style={{
                              width: '40px',
                              height: '40px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid #E1E3E5',
                            }}
                          />
                        ))}
                        {testImages.length > 3 && (
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '4px',
                              border: '1px solid #E1E3E5',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#F6F6F7',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#6D7175',
                            }}
                          >
                            +{testImages.length - 3}
                          </div>
                        )}
                      </div>,
                      test.name,
                      test.statistics.lift > 0 ? 'Test' : test.statistics.lift < 0 ? 'Base' : 'Tie',
                      `${test.statistics.lift >= 0 ? '+' : ''}${test.statistics.lift.toFixed(2)}%`,
                      `${test.statistics.base.conversions} vs ${test.statistics.test.conversions}`,
                      <div key={`completed-actions-${test.id}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            url={`/app/ab-tests/${test.id}`}
                          >
                            View Stats
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => handleAction(test.id, 'delete')}
                            loading={fetcher.state !== 'idle'}
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
    </Page>
  );
}