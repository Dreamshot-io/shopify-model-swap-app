import { Card, BlockStack, Text, Button, Icon } from '@shopify/polaris';
import { PlusCircleIcon } from '@shopify/polaris-icons';
import { useNavigate } from '@remix-run/react';

interface CreateTestCardProps {
  productId: string;
  variant?: 'default' | 'compact';
}

export function CreateTestCard({ productId, variant = 'default' }: CreateTestCardProps) {
  const navigate = useNavigate();

  const handleCreateTest = () => {
    navigate(`/app/create-test/${encodeURIComponent(productId)}`);
  };

  if (variant === 'compact') {
    return (
      <Card>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            cursor: 'pointer',
            height: '100%',
            minHeight: '140px',
          }}
          onClick={handleCreateTest}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#F1F2F4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = '#E3E5E7')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = '#F1F2F4')
            }
          >
            <Icon source={PlusCircleIcon} tone="base" />
          </div>
          <BlockStack gap="050" align="center">
            <Text variant="headingMd" as="h3" alignment="center">
              Create A/B Test
            </Text>
            <Text as="p" tone="subdued" variant="bodySm" alignment="center">
              Test images to improve conversions
            </Text>
          </BlockStack>
          <Button
            variant="primary"
            onClick={handleCreateTest}
          >
            Create Test
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="500" align="center" inlineAlign="center">
        <div
          style={{
            padding: '40px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            cursor: 'pointer',
            width: '100%',
            maxWidth: '400px',
          }}
          onClick={handleCreateTest}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#F1F2F4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = '#E3E5E7')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = '#F1F2F4')
            }
          >
            <Icon source={PlusCircleIcon} tone="base" />
          </div>
          <BlockStack gap="200" align="center">
            <Text variant="headingLg" as="h3" alignment="center">
              Create A/B Test
            </Text>
            <Text as="p" tone="subdued" alignment="center">
              Test different images to discover what converts better
            </Text>
          </BlockStack>
          <Button
            variant="primary"
            size="large"
            onClick={handleCreateTest}
          >
            Create A/B Test
          </Button>
        </div>
      </BlockStack>
    </Card>
  );
}
