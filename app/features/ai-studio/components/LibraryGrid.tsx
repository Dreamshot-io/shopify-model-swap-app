import { Button, Card, Grid, Text, BlockStack } from "@shopify/polaris";
import type { LibraryItem } from "../types";

export function LibraryGrid({
  libraryItems,
  onPublish,
  onPreview,
  onRemove,
}: {
  libraryItems: LibraryItem[];
  onPublish: (url: string) => void;
  onPreview: (url: string, baseUrl?: string | null) => void;
  onRemove?: (url: string) => void;
}) {
  if (!libraryItems?.length) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Library ({libraryItems.length})
        </Text>
        <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
          {libraryItems.map((item) => {
            const url = typeof item === "string" ? (item as string) : item.imageUrl;
            const base = typeof item === "string" ? null : item.sourceUrl || null;
            return (
              <Card key={url}>
                <BlockStack gap="300">
                  <div>
                    <img
                      src={url}
                      alt="Library variant"
                      style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        borderRadius: "8px",
                        border: "1px solid #E1E3E5",
                      }}
                    />
                  </div>
                  <BlockStack gap="200">
                    <Button
                      onClick={() => onPublish(url)}
                      variant="primary"
                      fullWidth
                    >
                      🚀 Publish to Product
                    </Button>
                    <Button onClick={() => onPreview(url, base)} fullWidth>
                      🔍 Preview
                    </Button>
                    {onRemove && (
                      <Button
                        tone="critical"
                        variant="plain"
                        onClick={() => onRemove(url)}
                        fullWidth
                      >
                        🗑 Remove
                      </Button>
                    )}
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
