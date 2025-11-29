import { BlockStack } from '@shopify/polaris';
import { useNavigate, useSearchParams } from '@remix-run/react';
import { ProductStatsRow } from './ProductStatsRow';
import { TestHistoryList } from './TestHistoryList';
import { CreateTestCard } from './CreateTestCard';
import { ProductImagesPreview } from './ProductImagesPreview';
import type { ABTestWithStats, ProductStats, ProductMedia, LibraryItem } from '../types';

interface HomeTabContentProps {
  productId: string;
  productStats: ProductStats;
  tests: ABTestWithStats[];
  productMedia: ProductMedia[];
  libraryImages: LibraryItem[];
}

export function HomeTabContent({
  productId,
  productStats,
  tests,
  productMedia,
  libraryImages,
}: HomeTabContentProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasTests = tests.length > 0;

  const handleAddImages = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', 'images');
    navigate(`?${newParams.toString()}`);
  };

  return (
    <BlockStack gap="400">
      {/* Row 1: Split 40/60 - Create Test Card + Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: '16px', alignItems: 'stretch' }}>
        <CreateTestCard productId={productId} variant="compact" />
        <ProductStatsRow stats={productStats} layout="grid" />
      </div>

      {/* Row 2: Product Images Preview */}
      <ProductImagesPreview
        productMedia={productMedia}
        libraryImages={libraryImages}
        onAddImages={handleAddImages}
      />

      {/* Row 3: Test History - show if tests exist */}
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
