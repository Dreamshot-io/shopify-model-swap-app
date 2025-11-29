import { Card, BlockStack, InlineStack, Text, Button } from '@shopify/polaris';
import { ImageAddIcon } from '@shopify/polaris-icons';
import type { ProductMedia, LibraryItem } from '../types';

interface ProductImagesPreviewProps {
  productMedia: ProductMedia[];
  libraryImages: LibraryItem[];
  onAddImages: () => void;
  maxVisible?: number;
}

export function ProductImagesPreview({
  productMedia,
  libraryImages,
  onAddImages,
  maxVisible = 8,
}: ProductImagesPreviewProps) {
  // Combine product media and library images
  const productImages = productMedia
    .filter((m) => m.image?.url)
    .map((m) => ({
      url: m.image!.url,
      alt: m.alt || m.image?.altText || 'Product image',
      source: 'shopify' as const,
    }));

  const aiImages = libraryImages.map((item) => ({
    url: item.imageUrl,
    alt: 'AI generated image',
    source: 'library' as const,
  }));

  const allImages = [...productImages, ...aiImages];
  const visibleImages = allImages.slice(0, maxVisible);
  const hiddenCount = allImages.length - maxVisible;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text variant="headingMd" as="h3">
            Product Images
          </Text>
          <Button
            icon={ImageAddIcon}
            onClick={onAddImages}
          >
            Add More Images
          </Button>
        </InlineStack>

        {allImages.length === 0 ? (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              backgroundColor: '#F6F6F7',
              borderRadius: '8px',
            }}
          >
            <BlockStack gap="200" align="center">
              <Text as="p" tone="subdued">
                No images yet
              </Text>
              <Button onClick={onAddImages}>
                Add Images
              </Button>
            </BlockStack>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(visibleImages.length + (hiddenCount > 0 ? 1 : 0), maxVisible + 1)}, 1fr)`,
              gap: '12px',
            }}
          >
            {visibleImages.map((image, index) => (
              <div
                key={`${image.source}-${index}`}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid #E3E5E7',
                }}
              >
                <img
                  src={image.url}
                  alt={image.alt}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                {image.source === 'library' && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      backgroundColor: 'rgba(0, 128, 96, 0.9)',
                      color: 'white',
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '3px',
                    }}
                  >
                    AI
                  </div>
                )}
              </div>
            ))}

            {hiddenCount > 0 && (
              <div
                style={{
                  aspectRatio: '1',
                  borderRadius: '8px',
                  backgroundColor: '#F6F6F7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  border: '1px solid #E3E5E7',
                }}
                onClick={onAddImages}
              >
                <Text as="span" tone="subdued" fontWeight="semibold">
                  +{hiddenCount}
                </Text>
              </div>
            )}
          </div>
        )}
      </BlockStack>
    </Card>
  );
}
