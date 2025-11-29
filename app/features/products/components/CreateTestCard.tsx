import { Card, BlockStack, Text, Button, Icon } from '@shopify/polaris';
import { PlusCircleIcon } from '@shopify/polaris-icons';

interface CreateTestCardProps {
  onCreateTest: () => void;
}

export function CreateTestCard({ onCreateTest }: CreateTestCardProps) {
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
          onClick={onCreateTest}
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
            onClick={(e) => {
              e.stopPropagation();
              onCreateTest();
            }}
          >
            Create A/B Test
          </Button>
        </div>
      </BlockStack>
    </Card>
  );
}
