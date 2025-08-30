import { Button, Card, Grid, Text, BlockStack } from "@shopify/polaris";
import type { DraftItem } from "../types";

export function DraftsGrid({
  drafts,
  onPublish,
  onPreview,
  onRemove,
}: {
  drafts: DraftItem[];
  onPublish: (url: string) => void;
  onPreview: (url: string, baseUrl?: string | null) => void;
  onRemove?: (url: string) => void;
}) {
  if (!drafts?.length) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Drafts ({drafts.length})
        </Text>
        <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
          {drafts.map((d) => {
            const url = typeof d === "string" ? (d as string) : d.imageUrl;
            const base = typeof d === "string" ? null : d.sourceUrl || null;
            return (
              <Card key={url}>
                <BlockStack gap="300">
                  <div>
                    <img
                      src={url}
                      alt="Draft image"
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
                      🚀 Publish Draft to Product
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
