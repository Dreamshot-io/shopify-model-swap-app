import { useEffect } from 'react';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher, useNavigate } from '@remix-run/react';
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  DataTable,
  ProgressBar,
  Divider,
} from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { SimpleRotationService } from '../services/simple-rotation.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const testId = params.id;

  if (!testId) {
    throw new Response('Test ID required', { status: 400 });
  }

  const test = await db.aBTest.findUnique({
    where: { id: testId },
    include: {
      variants: true,
      events: {
        orderBy: { createdAt: 'desc' },
        take: 1000,
      },
      rotationEvents: {
        orderBy: { timestamp: 'desc' },
        take: 20,
      },
      auditLogs: {
        orderBy: { timestamp: 'desc' },
        take: 50,
      },
    },
  });

  if (!test || test.shop !== session.shop) {
    throw new Response('Test not found', { status: 404 });
  }

  // Calculate statistics
  const baseEvents = test.events.filter(e => e.activeCase === 'BASE');
  const testEvents = test.events.filter(e => e.activeCase === 'TEST');

  const baseImpressions = baseEvents.filter(e => e.eventType === 'IMPRESSION').length;
  const testImpressions = testEvents.filter(e => e.eventType === 'IMPRESSION').length;

  const baseAddToCarts = baseEvents.filter(e => e.eventType === 'ADD_TO_CART').length;
  const testAddToCarts = testEvents.filter(e => e.eventType === 'ADD_TO_CART').length;

  const baseConversions = baseEvents.filter(e => e.eventType === 'PURCHASE').length;
  const testConversions = testEvents.filter(e => e.eventType === 'PURCHASE').length;

  const baseRevenue = baseEvents
    .filter(e => e.eventType === 'PURCHASE' && e.revenue)
    .reduce((sum, e) => sum + Number(e.revenue), 0);

  const testRevenue = testEvents
    .filter(e => e.eventType === 'PURCHASE' && e.revenue)
    .reduce((sum, e) => sum + Number(e.revenue), 0);

  const baseCVR = baseImpressions > 0 ? (baseConversions / baseImpressions) * 100 : 0;
  const testCVR = testImpressions > 0 ? (testConversions / testImpressions) * 100 : 0;

  const baseATC = baseImpressions > 0 ? (baseAddToCarts / baseImpressions) * 100 : 0;
  const testATC = testImpressions > 0 ? (testAddToCarts / testImpressions) * 100 : 0;

  const lift = baseCVR > 0 ? ((testCVR - baseCVR) / baseCVR) * 100 : 0;

  return json({
    test,
    statistics: {
      base: {
        impressions: baseImpressions,
        addToCarts: baseAddToCarts,
        conversions: baseConversions,
        revenue: baseRevenue,
        cvr: baseCVR,
        atc: baseATC,
      },
      test: {
        impressions: testImpressions,
        addToCarts: testAddToCarts,
        conversions: testConversions,
        revenue: testRevenue,
        cvr: testCVR,
        atc: testATC,
      },
      lift,
      totalSessions: new Set(test.events.map(e => e.sessionId)).size,
    },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const testId = params.id!;
  const formData = await request.formData();
  const intent = formData.get('intent');

  try {
    switch (intent) {
      case 'start':
        await SimpleRotationService.startTest(testId, session.id);
        return json({ success: true, message: 'Test started' });

      case 'pause':
        await SimpleRotationService.pauseTest(testId, session.id, admin);
        return json({ success: true, message: 'Test paused and restored to base case' });

      case 'complete':
        await SimpleRotationService.completeTest(testId, admin, session.id);
        return json({ success: true, message: 'Test completed and restored to base images' });

      case 'rotate':
        const result = await SimpleRotationService.rotateTest(testId, 'MANUAL', session.id, admin);
        return json({ success: true, message: 'Rotation completed', result });

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

export default function ABTestDetail() {
  const { test, statistics } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  // Show toast on success
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  const handleAction = (intent: string) => {
    fetcher.submit({ intent }, { method: 'post' });
  };

  const isLoading = fetcher.state !== 'idle';

  const statusBadge = {
    DRAFT: { tone: 'info' as const, text: 'Draft' },
    ACTIVE: { tone: 'success' as const, text: 'Active' },
    PAUSED: { tone: 'attention' as const, text: 'Paused' },
    COMPLETED: { tone: '' as const, text: 'Completed' },
  }[test.status] || { tone: 'info' as const, text: test.status };

  const caseBadge = {
    BASE: { tone: 'info' as const, text: 'Base (Control)' },
    TEST: { tone: 'attention' as const, text: 'Test (Variant)' },
  }[test.currentCase] || { tone: 'info' as const, text: test.currentCase };

  // Format statistics for display
  const statsRows = [
    ['Impressions', statistics.base.impressions.toString(), statistics.test.impressions.toString()],
    ['Add to Carts', statistics.base.addToCarts.toString(), statistics.test.addToCarts.toString()],
    ['ATC Rate', `${statistics.base.atc.toFixed(2)}%`, `${statistics.test.atc.toFixed(2)}%`],
    ['Purchases', statistics.base.conversions.toString(), statistics.test.conversions.toString()],
    ['Conversion Rate', `${statistics.base.cvr.toFixed(2)}%`, `${statistics.test.cvr.toFixed(2)}%`],
    ['Revenue', `$${statistics.base.revenue.toFixed(2)}`, `$${statistics.test.revenue.toFixed(2)}%`],
  ];

  const rotationRows = test.rotationEvents.map((event: any) => [
    new Date(event.timestamp).toLocaleString(),
    `${event.fromCase} → ${event.toCase}`,
    event.triggeredBy,
    event.success ? '✓ Success' : '✗ Failed',
    `${event.duration}ms`,
  ]);

  return (
    <Page
      title={test.name}
      backAction={{
        content: `Back to ${test.productId.split('/').pop()}`,
        onAction: () => navigate(`/app/ab-tests?productId=${encodeURIComponent(test.productId)}`)
      }}
    >
      <Layout>
        {/* Error Banner (success uses toast) */}
        {fetcher.data?.success === false && (
          <Layout.Section>
            <Banner tone="critical" title="Error">
              <Text as="p">{fetcher.data.error}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Badge tone={statusBadge.tone}>{statusBadge.text}</Badge>
                    <Badge tone={caseBadge.tone}>{caseBadge.text}</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Product: {test.productId}
                  </Text>
                  <Text as="p" tone="subdued">
                    Rotation: Every {test.rotationHours} hours
                  </Text>
                  {test.nextRotation && (
                    <Text as="p" tone="subdued">
                      Next rotation: {new Date(test.nextRotation).toLocaleString()}
                    </Text>
                  )}
                </BlockStack>

                <InlineStack gap="200">
                  {test.status === 'DRAFT' && (
                    <Button
                      variant="primary"
                      onClick={() => handleAction('start')}
                      loading={isLoading}
                    >
                      Start Test
                    </Button>
                  )}
                  {test.status === 'ACTIVE' && (
                    <>
                      <Button onClick={() => handleAction('pause')} loading={isLoading}>
                        Pause
                      </Button>
                      <Button onClick={() => handleAction('rotate')} loading={isLoading}>
                        Rotate Now
                      </Button>
                      <Button
                        tone="critical"
                        onClick={() => handleAction('complete')}
                        loading={isLoading}
                      >
                        Complete Test
                      </Button>
                    </>
                  )}
                  {test.status === 'PAUSED' && (
                    <Button
                      variant="primary"
                      onClick={() => handleAction('start')}
                      loading={isLoading}
                    >
                      Resume
                    </Button>
                  )}
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Performance Statistics
              </Text>

              {statistics.totalSessions === 0 ? (
                <Banner tone="info">
                  <Text as="p">No data yet. Start the test to begin collecting data.</Text>
                </Banner>
              ) : (
                <>
                  <InlineStack gap="400" align="space-between">
                    <Text as="p">Total Sessions: {statistics.totalSessions}</Text>
                    <Text as="p" fontWeight="bold">
                      Lift: {statistics.lift >= 0 ? '+' : ''}{statistics.lift.toFixed(2)}%
                    </Text>
                  </InlineStack>

                  {statistics.lift !== 0 && (
                    <ProgressBar
                      progress={Math.min(Math.abs(statistics.lift), 100)}
                      tone={statistics.lift > 0 ? 'success' : 'critical'}
                      size="small"
                    />
                  )}

                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric']}
                    headings={['Metric', 'Base (Control)', 'Test (Variant)']}
                    rows={statsRows}
                  />
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Rotation History
              </Text>

              {test.rotationEvents.length === 0 ? (
                <Text as="p" tone="subdued">
                  No rotations yet
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Time', 'Rotation', 'Triggered By', 'Status', 'Duration']}
                  rows={rotationRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Recent Activity
              </Text>

              {test.auditLogs.length === 0 ? (
                <Text as="p" tone="subdued">
                  No activity yet
                </Text>
              ) : (
                <BlockStack gap="200">
                  {test.auditLogs.slice(0, 10).map((log: any) => (
                    <div key={log.id}>
                      <InlineStack align="space-between">
                        <Text as="p">{log.description}</Text>
                        <Text as="p" tone="subdued">
                          {new Date(log.timestamp).toLocaleString()}
                        </Text>
                      </InlineStack>
                      <Divider />
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}