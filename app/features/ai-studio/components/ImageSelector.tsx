import { Box, Grid, Text } from "@shopify/polaris";

type MediaNode = {
  id: string;
  image?: { url?: string; altText?: string } | null;
};

export function ImageSelector({
  media,
  selectedImage,
  onSelect,
}: {
  media: MediaNode[];
  selectedImage: string | null;
  onSelect: (url: string) => void;
}) {
  return (
    <>
      <Text as="h3" variant="headingMd">
        Select Source Image
      </Text>
      <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2 }}>
        {media?.map((m) => (
          <Box key={m.id}>
            <div
              onClick={() => m.image?.url && onSelect(m.image.url)}
              style={{
                cursor: m.image?.url ? "pointer" : "default",
                position: "relative",
                width: "100%",
                border:
                  selectedImage === m.image?.url
                    ? "2px solid #008060"
                    : "1px solid #E1E3E5",
                borderRadius: "12px",
                overflow: "hidden",
                backgroundColor: "#F6F6F7",
                boxShadow:
                  selectedImage === m.image?.url
                    ? "0 0 0 2px rgba(0,128,96,0.15)"
                    : "none",
              }}
            >
              <img
                src={m.image?.url}
                alt={m.image?.altText || "Product image"}
                style={{ width: "100%", height: "auto", display: "block" }}
              />
              {selectedImage === m.image?.url && (
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    backgroundColor: "rgba(0, 128, 96, 0.95)",
                    color: "white",
                    padding: "4px",
                    borderRadius: "50%",
                    fontSize: "14px",
                    fontWeight: "700",
                    textAlign: "center",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                    minWidth: "28px",
                    height: "28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ✓
                </div>
              )}
            </div>
          </Box>
        ))}
      </Grid>
    </>
  );
}
