import { InlineStack, Badge } from '@shopify/polaris';
import { useNavigate } from '@remix-run/react';
import type { TabType } from '../types';

interface ProductHubTabsProps {
  productId: string;
  currentTab: TabType;
  imageCount?: number;
  activeTestCount?: number;
  testCount?: number;
}

export function ProductHubTabs({
  productId,
  currentTab,
  imageCount = 0,
  activeTestCount = 0,
  testCount = 0,
}: ProductHubTabsProps) {
  const navigate = useNavigate();

  const handleTabChange = (tab: TabType) => {
    const tabParam = tab === 'home' ? '' : `?tab=${tab}`;
    navigate(`/app/products/${encodeURIComponent(productId)}${tabParam}`);
  };

  const tabs: Array<{
    id: TabType;
    label: string;
    badge?: { count: number; tone?: 'success' | 'info' | 'attention' };
  }> = [
    { id: 'home', label: 'Overview' },
    {
      id: 'images',
      label: 'Images',
      badge: imageCount > 0 ? { count: imageCount, tone: 'info' } : undefined,
    },
    {
      id: 'tests',
      label: 'Tests',
      badge: activeTestCount > 0
        ? { count: activeTestCount, tone: 'success' }
        : testCount > 0
          ? { count: testCount, tone: 'info' }
          : undefined,
    },
  ];

  return (
    <div
      style={{
        borderBottom: '1px solid #E1E3E5',
        backgroundColor: '#FFFFFF',
        padding: '0 20px',
        marginBottom: '12px',
      }}
    >
      <InlineStack gap="400" align="start">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              padding: '12px 16px',
              cursor: 'pointer',
              borderBottom:
                currentTab === tab.id ? '2px solid #008060' : '2px solid transparent',
              color: currentTab === tab.id ? '#008060' : '#6D7175',
              fontWeight: currentTab === tab.id ? '600' : '400',
              fontSize: '14px',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
            onMouseEnter={(e) => {
              if (currentTab !== tab.id) {
                e.currentTarget.style.color = '#202223';
              }
            }}
            onMouseLeave={(e) => {
              if (currentTab !== tab.id) {
                e.currentTarget.style.color = '#6D7175';
              }
            }}
          >
            {tab.label}
            {tab.badge && (
              <Badge tone={tab.badge.tone}>
                {tab.badge.count}
              </Badge>
            )}
          </button>
        ))}
      </InlineStack>
    </div>
  );
}
