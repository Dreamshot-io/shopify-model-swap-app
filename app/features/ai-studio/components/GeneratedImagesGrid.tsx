import { Button, Card, Grid, Text, BlockStack } from "@shopify/polaris";
import type { GeneratedImage } from "../types";

export function GeneratedImagesGrid({
  images,
  onPublish,
  onSaveToLibrary,
  onPreview,
  isBusy,
}: {
  images: GeneratedImage[];
  onPublish: (image: GeneratedImage) => void;
  onSaveToLibrary: (image: GeneratedImage) => void;
  onPreview: (image: GeneratedImage) => void;
  isBusy?: boolean;
}) {
  if (!images?.length) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Generated Images ({images.length})
        </Text>
        <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
          {images.map((image, index) => {
            // Ensure we have a unique key, fallback to index if id is missing
            const imageKey = image.id || `generated-${index}`;
            
            return (
              <Card key={imageKey}>
                <BlockStack gap="300">
                  <div>
                    <img
                      src={image.imageUrl}
                      alt="Generated image"
                      style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        borderRadius: "8px",
                        border: "1px solid #E1E3E5",
                      }}
                    />
                  </div>
                <Text as="p" alignment="center">
                  Confidence:{" "}
                  <strong>{Math.round(image.confidence * 100)}%</strong>
                </Text>
                <BlockStack gap="200">
                  <Button
                    onClick={() => onPublish(image)}
                    variant="primary"
                    fullWidth
                    disabled={!!isBusy}
                  >
                    🚀 Publish to Product
                  </Button>
                  <Button
                    onClick={() => onSaveToLibrary(image)}
                    fullWidth
                    disabled={!!isBusy}
                  >
                    💾 Save to Library
                  </Button>
                  <Button
                    onClick={() => onPreview(image)}
                    fullWidth
                    disabled={!!isBusy}
                  >
                    🔍 Preview
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>
            );
          })}
        </Grid>
      </BlockStack>
    </Card>
  );
}
