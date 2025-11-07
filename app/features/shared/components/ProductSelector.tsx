import { useState } from 'react';
import {
  Card,
  BlockStack,
  Text,
  TextField,
  InlineGrid,
  EmptyState,
  InlineStack,
  Badge,
} from '@shopify/polaris';

interface Product {
  id: string;
  title: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
  status?: string;
}

interface ProductSelectorProps {
  products: Product[];
  onSelectProduct: (productId: string) => void;
  title?: string;
  description?: string;
  emptyStateHeading?: string;
  emptyStateMessage?: string;
  showBadges?: boolean;
  badgeData?: Record<string, { count: number; tone?: 'success' | 'info' | 'warning' | 'critical' }>;
}

export function ProductSelector({
  products,
  onSelectProduct,
  title = 'Select a Product',
  description,
  emptyStateHeading = 'No products found',
  emptyStateMessage = 'Create products in your store to get started',
  showBadges = false,
  badgeData = {},
}: ProductSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = products.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <BlockStack gap="500">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            {title}
          </Text>
          {description && (
            <Text as="p" tone="subdued">
              {description}
            </Text>
          )}
          <TextField
            label=""
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search products..."
            autoComplete="off"
            clearButton
            onClearButtonClick={() => setSearchQuery('')}
          />
        </BlockStack>
      </Card>

      {filteredProducts.length === 0 ? (
        <Card>
          <EmptyState
            heading={searchQuery ? 'No products match your search' : emptyStateHeading}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {searchQuery ? 'Try adjusting your search' : emptyStateMessage}
            </p>
          </EmptyState>
        </Card>
      ) : (
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
          {filteredProducts.map((product) => {
            const badge = badgeData[product.id];

            return (
              <Card key={product.id}>
                <BlockStack gap="300">
                  {product.featuredImage?.url ? (
                    <div
                      onClick={() => onSelectProduct(product.id)}
                      style={{
                        cursor: 'pointer',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        aspectRatio: '1',
                        backgroundColor: '#F6F6F7',
                        position: 'relative',
                      }}
                    >
                      <img
                        src={product.featuredImage.url}
                        alt={product.featuredImage.altText || product.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                      {showBadges && badge && badge.count > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                          }}
                        >
                          <Badge tone={badge.tone || 'info'}>
                            {badge.count} {badge.count === 1 ? 'test' : 'tests'}
                          </Badge>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      onClick={() => onSelectProduct(product.id)}
                      style={{
                        cursor: 'pointer',
                        borderRadius: '8px',
                        aspectRatio: '1',
                        backgroundColor: '#F6F6F7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text as="p" tone="subdued">
                        No image
                      </Text>
                    </div>
                  )}
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd" truncate>
                      {product.title}
                    </Text>
                    <InlineStack align="space-between">
                      <Text as="p" tone="subdued">
                        {product.status}
                      </Text>
                      <button
                        onClick={() => onSelectProduct(product.id)}
                        style={{
                          background: '#008060',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '8px 16px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '500',
                        }}
                      >
                        Select
                      </button>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>
      )}
    </BlockStack>
  );
}