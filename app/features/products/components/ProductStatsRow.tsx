import { Card, InlineStack, BlockStack, Text, Icon } from '@shopify/polaris';
import { ViewIcon, CartIcon, OrderIcon, CashDollarIcon } from '@shopify/polaris-icons';
import type { ProductStats } from '../types';

interface ProductStatsRowProps {
  stats: ProductStats;
}

export function ProductStatsRow({ stats }: ProductStatsRowProps) {
  // Calculate CTR (Click-Through Rate: ATC / Impressions)
  const ctr = stats.impressions > 0 ? (stats.addToCarts / stats.impressions) * 100 : 0;
  // Calculate CVR (Conversion Rate: Purchases / ATC)
  const cvr = stats.addToCarts > 0 ? (stats.purchases / stats.addToCarts) * 100 : 0;

  const metrics = [
    {
      label: 'Impressions',
      value: stats.impressions.toLocaleString(),
      icon: ViewIcon,
    },
    {
      label: 'CTR',
      value: `${ctr.toFixed(1)}%`,
      icon: ViewIcon,
    },
    {
      label: 'Add to Carts',
      value: stats.addToCarts.toLocaleString(),
      icon: CartIcon,
    },
    {
      label: 'CVR',
      value: `${cvr.toFixed(1)}%`,
      icon: CartIcon,
    },
    {
      label: 'Purchases',
      value: stats.purchases.toLocaleString(),
      icon: OrderIcon,
    },
    {
      label: 'Revenue',
      value: `$${stats.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: CashDollarIcon,
    },
  ];

  return (
    <Card>
      <InlineStack gap="400" align="space-between" wrap={false}>
        {metrics.map((metric) => (
          <div key={metric.label} style={{ flex: 1, textAlign: 'center' }}>
            <BlockStack gap="100">
              <InlineStack gap="100" align="center">
                <div style={{ color: '#6D7175' }}>
                  <Icon source={metric.icon} tone="subdued" />
                </div>
                <Text as="span" tone="subdued" variant="bodySm">
                  {metric.label}
                </Text>
              </InlineStack>
              <Text as="span" variant="headingMd" fontWeight="bold">
                {metric.value}
              </Text>
            </BlockStack>
          </div>
        ))}
      </InlineStack>
    </Card>
  );
}
