import { useState, useEffect } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  DataTable,
  ProgressBar,
  Divider,
  Modal,
  Popover,
  Icon,
} from '@shopify/polaris';
import { CheckCircleIcon, QuestionCircleIcon, PlusCircleIcon } from '@shopify/polaris-icons';
import { useAppBridge } from '@shopify/app-bridge-react';
import { ABTestCreationForm } from '../../ab-testing/components';
import type { ABTestWithStats, LibraryItem } from '../types';

interface TestsTabContentProps {
  productId: string;
  productTitle: string;
  shop: string;
  activeTest: ABTestWithStats | null;
  draftTests: ABTestWithStats[];
  completedTests: ABTestWithStats[];
  libraryItems: LibraryItem[];
  productMedia: any[];
}

function formatRotationHours(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)} minutes`;
  }
  if (hours === 1) {
    return '1 hour';
  }
  if (hours < 24) {
    return `${hours} hours`;
  }
  const days = hours / 24;
  return days === 1 ? '1 day' : `${days} days`;
}

export function TestsTabContent({
  productId,
  productTitle,
  shop,
  activeTest,
  draftTests,
  completedTests,
}: TestsTabContentProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [rotationHelpActive, setRotationHelpActive] = useState(false);

  // Calculate countdown to next rotation
  useEffect(() => {
    if (!activeTest?.nextRotation) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const next = new Date(activeTest.nextRotation!);
      const now = new Date();
      const diff = next.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown('Due now');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else {
        setCountdown(`${minutes}m`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [activeTest?.nextRotation]);

  // Show toast on action result
  useEffect(() => {
    const fetcherData = fetcher.data as any;
    if (fetcherData?.success && fetcherData.message) {
      shopify.toast.show(fetcherData.message);
    } else if (fetcherData?.success === false && fetcherData.error) {
      shopify.toast.show(fetcherData.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleAction = (testId: string, intent: string) => {
    if (intent === 'complete') {
      setShowCompleteModal(true);
    } else {
      fetcher.submit(
        { testId, intent, productId },
        { method: 'post' }
      );
    }
  };

  const handleCompleteConfirm = () => {
    if (activeTest) {
      fetcher.submit(
        { testId: activeTest.id, intent: 'complete', productId },
        { method: 'post' }
      );
      setShowCompleteModal(false);
    }
  };

  const handleViewDetails = (testId: string) => {
    navigate(`/app/test-details/${testId}`);
  };

  const isLoading = fetcher.state !== 'idle';

  return (
    <BlockStack gap="400">
      {/* Active Test Card */}
      {activeTest && (
        <Card>
          <BlockStack gap="400">
            {/* Header Row */}
            <InlineStack align="space-between">
              <InlineStack gap="200">
                <Text variant="headingLg" as="h2">
                  {activeTest.name}
                </Text>
                <Badge tone={activeTest.status === 'ACTIVE' ? 'success' : 'attention'}>
                  {activeTest.status}
                </Badge>
                <Badge tone={activeTest.currentCase === 'BASE' ? 'info' : 'attention'}>
                  {activeTest.currentCase === 'BASE' ? 'Showing: Base' : 'Showing: Test'}
                </Badge>
              </InlineStack>
              <InlineStack gap="200">
                {activeTest.status === 'ACTIVE' ? (
                  <Button onClick={() => handleAction(activeTest.id, 'pause')} loading={isLoading}>
                    Pause
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => handleAction(activeTest.id, 'start')} loading={isLoading}>
                    Resume
                  </Button>
                )}
                <Button
                  onClick={() => handleAction(activeTest.id, 'rotate')}
                  loading={isLoading}
                  disabled={activeTest.status === 'PAUSED'}
                >
                  Rotate Now
                </Button>
                <Button
                  icon={CheckCircleIcon}
                  onClick={() => handleAction(activeTest.id, 'complete')}
                  loading={isLoading}
                >
                  Complete
                </Button>
              </InlineStack>
            </InlineStack>

            {/* Rotation Info */}
            <InlineStack gap="200" align="start">
              <Text as="p" tone="subdued">
                Rotation: Every {formatRotationHours(activeTest.rotationHours)}
                {activeTest.nextRotation && countdown && ` • Next: ${countdown}`}
              </Text>
              {activeTest.nextRotation && (
                <Popover
                  active={rotationHelpActive}
                  activator={
                    <button
                      type="button"
                      onClick={() => setRotationHelpActive(!rotationHelpActive)}
                      style={{
                        cursor: 'help',
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                      }}
                    >
                      <Icon source={QuestionCircleIcon} tone="subdued" />
                    </button>
                  }
                  onClose={() => setRotationHelpActive(false)}
                >
                  <div style={{ padding: '16px' }}>
                    <Text as="p">
                      Tests automatically rotate between Base and Test cases at the specified interval.
                    </Text>
                  </div>
                </Popover>
              )}
            </InlineStack>

            {/* Lift Indicator */}
            {activeTest.statistics.lift !== 0 && (
              <BlockStack gap="200">
                <Text as="p" variant="headingMd" fontWeight="bold">
                  Lift: {activeTest.statistics.lift >= 0 ? '+' : ''}
                  {activeTest.statistics.lift.toFixed(1)}%
                </Text>
                <ProgressBar
                  progress={Math.min(Math.abs(activeTest.statistics.lift), 100)}
                  tone={activeTest.statistics.lift > 0 ? 'success' : 'critical'}
                  size="medium"
                />
              </BlockStack>
            )}

            <Divider />

            {/* Statistics Table */}
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
              headings={['Variant', 'Preview', 'Impressions', 'ATC', 'ATC Rate', 'CVR', 'Revenue']}
              rows={[
                [
                  'Base (Control)',
                  <ImagePreviewCell key="base" images={activeTest.baseImages} />,
                  activeTest.statistics.base.impressions.toLocaleString(),
                  (activeTest.statistics.base.addToCarts || 0).toLocaleString(),
                  activeTest.statistics.base.impressions > 0
                    ? `${(((activeTest.statistics.base.addToCarts || 0) / activeTest.statistics.base.impressions) * 100).toFixed(1)}%`
                    : '0%',
                  `${activeTest.statistics.base.cvr.toFixed(1)}%`,
                  `$${(activeTest.statistics.base.revenue || 0).toFixed(2)}`,
                ],
                [
                  'Test (Variant)',
                  <ImagePreviewCell key="test" images={activeTest.testImages} />,
                  activeTest.statistics.test.impressions.toLocaleString(),
                  (activeTest.statistics.test.addToCarts || 0).toLocaleString(),
                  activeTest.statistics.test.impressions > 0
                    ? `${(((activeTest.statistics.test.addToCarts || 0) / activeTest.statistics.test.impressions) * 100).toFixed(1)}%`
                    : '0%',
                  `${activeTest.statistics.test.cvr.toFixed(1)}%`,
                  `$${(activeTest.statistics.test.revenue || 0).toFixed(2)}`,
                ],
              ]}
            />

            {/* View Details Link */}
            <InlineStack align="end">
              <Button variant="plain" onClick={() => handleViewDetails(activeTest.id)}>
                View Full Details
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      {/* Draft Tests Section */}
      {draftTests.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h3">
                Draft Tests
              </Text>
              <Text as="span" tone="subdued">
                {draftTests.length} draft{draftTests.length !== 1 ? 's' : ''}
              </Text>
            </InlineStack>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
              headings={['Preview', 'Name', 'Status', 'Test Images', 'Actions']}
              rows={draftTests.map((test) => [
                <ImagePreviewCell key={`preview-${test.id}`} images={test.testImages} />,
                test.name,
                <Badge key={`status-${test.id}`} tone={test.status === 'PAUSED' ? 'attention' : 'info'}>
                  {test.status}
                </Badge>,
                Array.isArray(test.testImages) ? test.testImages.length.toString() : '0',
                <InlineStack key={`actions-${test.id}`} gap="200">
                  <Button
                    size="slim"
                    onClick={() => handleAction(test.id, 'start')}
                    loading={isLoading}
                    disabled={!!activeTest}
                  >
                    {test.status === 'PAUSED' ? 'Resume' : 'Start'}
                  </Button>
                  <Button
                    size="slim"
                    tone="critical"
                    onClick={() => handleAction(test.id, 'delete')}
                    loading={isLoading}
                  >
                    Delete
                  </Button>
                </InlineStack>,
              ])}
            />
            {activeTest && (
              <Text as="p" tone="subdued">
                Complete or pause the active test before starting another.
              </Text>
            )}
          </BlockStack>
        </Card>
      )}

      {/* Completed Tests Section */}
      {completedTests.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h3">
                Completed Tests
              </Text>
              <Text as="span" tone="subdued">
                {completedTests.length} test{completedTests.length !== 1 ? 's' : ''}
              </Text>
            </InlineStack>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'numeric', 'text', 'text']}
              headings={['Preview', 'Name', 'Winner', 'Lift', 'Conversions', 'Actions']}
              rows={completedTests.map((test) => {
                const winner = test.statistics.lift > 0 ? 'Test' : test.statistics.lift < 0 ? 'Base' : 'Tie';
                return [
                  <ImagePreviewCell key={`preview-${test.id}`} images={test.testImages} />,
                  test.name,
                  <Text
                    key={`winner-${test.id}`}
                    as="span"
                    fontWeight={winner === 'Test' ? 'bold' : 'regular'}
                    tone={winner === 'Test' ? 'success' : undefined}
                  >
                    {winner}
                  </Text>,
                  <Text
                    key={`lift-${test.id}`}
                    as="span"
                    tone={test.statistics.lift > 0 ? 'success' : test.statistics.lift < 0 ? 'critical' : undefined}
                  >
                    {test.statistics.lift >= 0 ? '+' : ''}{test.statistics.lift.toFixed(1)}%
                  </Text>,
                  `${test.statistics.base.conversions} vs ${test.statistics.test.conversions}`,
                  <Button
                    key={`actions-${test.id}`}
                    size="slim"
                    onClick={() => handleViewDetails(test.id)}
                  >
                    View
                  </Button>,
                ];
              })}
            />
          </BlockStack>
        </Card>
      )}

      {/* Create Test Section */}
      {showCreateForm ? (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                Create New Test
              </Text>
              <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </InlineStack>
            <ABTestCreationForm
              productId={productId}
              productTitle={productTitle}
              shop={shop}
              onSuccess={() => {
                setShowCreateForm(false);
                shopify.toast.show('Test created successfully!');
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          </BlockStack>
        </Card>
      ) : (
        <Card>
          <BlockStack gap="400" align="center" inlineAlign="center">
            <div
              style={{
                padding: '24px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
                cursor: 'pointer',
                width: '100%',
              }}
              onClick={() => setShowCreateForm(true)}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  backgroundColor: '#F1F2F4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E3E5E7')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#F1F2F4')}
              >
                <Icon source={PlusCircleIcon} tone="base" />
              </div>
              <BlockStack gap="100" align="center">
                <Text variant="headingMd" as="h3" alignment="center">
                  Create New A/B Test
                </Text>
                <Text as="p" tone="subdued" alignment="center">
                  Test different images to discover what converts better
                </Text>
              </BlockStack>
              <Button
                variant="primary"
                onClick={() => setShowCreateForm(true)}
              >
                + Create New Test
              </Button>
            </div>
          </BlockStack>
        </Card>
      )}

      {/* Complete Confirmation Modal */}
      <Modal
        open={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        title="Complete Test"
        primaryAction={{
          content: 'Complete',
          onAction: handleCompleteConfirm,
          destructive: true,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setShowCompleteModal(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to complete this test? This action cannot be undone
            and will stop the test from collecting new data.
          </Text>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

// Helper component for image previews
function ImagePreviewCell({ images }: { images: string | string[] }) {
  let imageArray: any[] = [];

  if (typeof images === 'string') {
    try {
      imageArray = JSON.parse(images);
    } catch {
      imageArray = [];
    }
  } else if (Array.isArray(images)) {
    imageArray = images;
  }

  if (imageArray.length === 0) {
    return <Text as="span" tone="subdued">No images</Text>;
  }

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {imageArray.slice(0, 3).map((img: any, idx: number) => (
        <img
          key={idx}
          src={typeof img === 'string' ? img : img?.url || ''}
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
      {imageArray.length > 3 && (
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
          +{imageArray.length - 3}
        </div>
      )}
    </div>
  );
}
