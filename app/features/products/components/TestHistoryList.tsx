import { useState } from 'react';
import { Card, BlockStack, Text, Badge, InlineStack, DataTable, Button, ButtonGroup } from '@shopify/polaris';
import { useNavigate } from '@remix-run/react';
import type { ABTestWithStats } from '../types';

interface TestHistoryListProps {
  tests: ABTestWithStats[];
  productId?: string;
  onViewTest?: (testId: string) => void;
}

const DEFAULT_VISIBLE_COUNT = 5;

function getStatusBadge(status: ABTestWithStats['status']) {
  switch (status) {
    case 'ACTIVE':
      return <Badge tone="success">Active</Badge>;
    case 'PAUSED':
      return <Badge tone="attention">Paused</Badge>;
    case 'DRAFT':
      return <Badge tone="info">Draft</Badge>;
    case 'COMPLETED':
      return <Badge>Completed</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function getWinnerText(test: ABTestWithStats): string {
  if (test.status === 'ACTIVE' || test.status === 'PAUSED' || test.status === 'DRAFT') {
    return '-';
  }
  if (test.statistics.lift > 0) {
    return 'Test';
  } else if (test.statistics.lift < 0) {
    return 'Base';
  }
  return 'Tie';
}

export function TestHistoryList({ tests, onViewTest }: TestHistoryListProps) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);

  if (tests.length === 0) {
    return null;
  }

  const handleViewTest = (testId: string) => {
    if (onViewTest) {
      onViewTest(testId);
    } else {
      navigate(`/app/test-details/${testId}`);
    }
  };

  // Sort tests: active first, then paused, then by date
  const sortedTests = [...tests].sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
    if (a.status === 'PAUSED' && b.status !== 'PAUSED') return -1;
    if (b.status === 'PAUSED' && a.status !== 'PAUSED') return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const visibleTests = showAll ? sortedTests : sortedTests.slice(0, DEFAULT_VISIBLE_COUNT);
  const hasMore = tests.length > DEFAULT_VISIBLE_COUNT;

  // Build table rows
  const rows = visibleTests.map((test) => {
    const totalImpressions = test.statistics.base.impressions + test.statistics.test.impressions;
    const totalConversions = test.statistics.base.conversions + test.statistics.test.conversions;
    const cvr = totalImpressions > 0 ? ((totalConversions / totalImpressions) * 100).toFixed(1) : '0.0';
    const lift = test.statistics.lift;
    const winner = getWinnerText(test);

    return [
      // Test name (clickable)
      <button
        key={`name-${test.id}`}
        onClick={() => handleViewTest(test.id)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: '#202223',
          fontWeight: 500,
        }}
      >
        {test.name}
      </button>,
      // Status badge
      getStatusBadge(test.status),
      // Impressions
      totalImpressions.toLocaleString(),
      // CVR
      `${cvr}%`,
      // Lift
      <Text
        key={`lift-${test.id}`}
        as="span"
        tone={lift > 0 ? 'success' : lift < 0 ? 'critical' : undefined}
      >
        {lift !== 0 ? `${lift > 0 ? '+' : ''}${lift.toFixed(1)}%` : '-'}
      </Text>,
      // Winner
      <Text
        key={`winner-${test.id}`}
        as="span"
        fontWeight={winner === 'Test' ? 'bold' : 'regular'}
        tone={winner === 'Test' ? 'success' : undefined}
      >
        {winner}
      </Text>,
      // View button
      <Button
        key={`view-${test.id}`}
        size="slim"
        onClick={() => handleViewTest(test.id)}
      >
        View
      </Button>,
    ];
  });

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text variant="headingMd" as="h3">
            Test History
          </Text>
          <Text as="span" tone="subdued">
            {tests.length} test{tests.length !== 1 ? 's' : ''}
          </Text>
        </InlineStack>

        <DataTable
          columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text', 'text', 'text']}
          headings={['Test', 'Status', 'Impr', 'CVR', 'Lift', 'Winner', '']}
          rows={rows}
          hoverable
        />

        {hasMore && (
          <div style={{ textAlign: 'center', paddingTop: '8px' }}>
            <Button
              variant="plain"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show less' : `Show all ${tests.length} tests`}
            </Button>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}
