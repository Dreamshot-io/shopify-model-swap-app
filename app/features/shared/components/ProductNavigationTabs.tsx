import { useNavigate } from '@remix-run/react';
import { InlineStack, Button, Text } from '@shopify/polaris';

interface ProductNavigationTabsProps {
  productId: string;
  currentPage: 'ai-studio' | 'ab-tests';
}

export function ProductNavigationTabs({
  productId,
  currentPage,
}: ProductNavigationTabsProps) {
  const navigate = useNavigate();

  const handleNavigate = (page: 'ai-studio' | 'ab-tests') => {
    navigate(`/app/${page}?productId=${encodeURIComponent(productId)}`);
  };

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
        <button
          onClick={() => handleNavigate('ai-studio')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom:
              currentPage === 'ai-studio' ? '2px solid #008060' : '2px solid transparent',
            color: currentPage === 'ai-studio' ? '#008060' : '#6D7175',
            fontWeight: currentPage === 'ai-studio' ? '600' : '400',
            fontSize: '14px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (currentPage !== 'ai-studio') {
              e.currentTarget.style.color = '#202223';
            }
          }}
          onMouseLeave={(e) => {
            if (currentPage !== 'ai-studio') {
              e.currentTarget.style.color = '#6D7175';
            }
          }}
        >
          🎨 AI Studio
        </button>
        <button
          onClick={() => handleNavigate('ab-tests')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom:
              currentPage === 'ab-tests' ? '2px solid #008060' : '2px solid transparent',
            color: currentPage === 'ab-tests' ? '#008060' : '#6D7175',
            fontWeight: currentPage === 'ab-tests' ? '600' : '400',
            fontSize: '14px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (currentPage !== 'ab-tests') {
              e.currentTarget.style.color = '#202223';
            }
          }}
          onMouseLeave={(e) => {
            if (currentPage !== 'ab-tests') {
              e.currentTarget.style.color = '#6D7175';
            }
          }}
        >
          🧪 A/B Tests
        </button>
      </InlineStack>
    </div>
  );
}

