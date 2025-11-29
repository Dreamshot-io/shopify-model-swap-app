import { BlockStack } from '@shopify/polaris';
import { useNavigate } from '@remix-run/react';
import { ProductStatsRow } from './ProductStatsRow';
import { TestHistoryList } from './TestHistoryList';
import { CreateTestCard } from './CreateTestCard';
import type { ABTestWithStats, ProductStats } from '../types';

interface HomeTabContentProps {
  productId: string;
  productStats: ProductStats;
  tests: ABTestWithStats[];
  onCreateTest: () => void;
}

export function HomeTabContent({
  productId,
  productStats,
  tests,
  onCreateTest,
}: HomeTabContentProps) {
  const navigate = useNavigate();
  const hasTests = tests.length > 0;

  return (
    <BlockStack gap="400">
      {/* Stats Row - always show */}
      <ProductStatsRow stats={productStats} />

      {/* Create Test CTA - always show to encourage more testing */}
      <CreateTestCard onCreateTest={onCreateTest} />

      {/* Test History - show if tests exist */}
      {hasTests && (
        <TestHistoryList
          tests={tests}
          productId={productId}
          onViewTest={(testId) => navigate(`/app/test-details/${testId}`)}
        />
      )}
    </BlockStack>
  );
}
