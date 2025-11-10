import { Text, InlineStack, Button, Badge } from "@shopify/polaris";
import type { SelectedImage, LibraryItem, GeneratedImage } from "../types";

type MediaNode = {
  id: string;
  image?: { url?: string; altText?: string } | null;
};

export function ImageSelector({
  media,
  libraryItems,
  generatedImages,
  selectedImages,
  onSelect,
  onClearSelection,
  onPublishFromLibrary,
  onRemoveFromLibrary,
}: {
  media: MediaNode[];
  libraryItems?: LibraryItem[];
  generatedImages?: GeneratedImage[];
  selectedImages: SelectedImage[];
  onSelect: (image: SelectedImage) => void;
  onClearSelection: () => void;
  onPublishFromLibrary?: (url: string) => void;
  onRemoveFromLibrary?: (url: string) => void;
}) {
  const isSelected = (url: string) =>
    selectedImages.some(img => img.url === url);

  const getSelectionNumber = (url: string) => {
    const index = selectedImages.findIndex(img => img.url === url);
    return index >= 0 ? index + 1 : null;
  };

  // Helper function to render image item
  const renderImageItem = (
    id: string,
    url: string,
    altText?: string,
    isAIGenerated = false,
    aiType?: 'session' | 'library',
    isLibraryItem = false,
  ) => {
    const isLibrary = isLibraryItem || aiType === 'library';
    
    return (
      <div
        key={id}
        style={{
          position: "relative",
          minWidth: "120px",
          maxWidth: "200px",
          flexShrink: 0,
        }}
      >
        <div
          onClick={() => {
            onSelect({
              id,
              url,
              altText,
              isAIGenerated,
            });
          }}
          style={{
            cursor: "pointer",
            position: "relative",
            border: isSelected(url)
              ? "3px solid #008060"
              : "2px solid #E1E3E5",
            borderRadius: "12px",
            overflow: "hidden",
            backgroundColor: "#F6F6F7",
            boxShadow: isSelected(url)
              ? "0 0 0 3px rgba(0,128,96,0.15)"
              : "0 2px 4px rgba(0,0,0,0.1)",
            transition: "all 0.2s ease",
          }}
        >
          <img
            src={url}
            alt={altText || (isAIGenerated ? "AI generated image" : "Product image")}
            style={{
              width: "100%",
              height: "auto",
              minHeight: "120px",
              maxHeight: "200px",
              objectFit: "cover",
              display: "block"
            }}
          />

          {/* Library badge */}
          {isLibrary && (
            <div
              style={{
                position: "absolute",
                top: "8px",
                left: "8px",
                zIndex: 3,
              }}
            >
              <Badge tone="info" size="small">Library</Badge>
            </div>
          )}

          {/* AI Generated tag */}
          {isAIGenerated && (
            <div
              style={{
                position: "absolute",
                top: "6px",
                right: "6px",
                backgroundColor: aiType === 'session'
                  ? "rgba(255, 99, 71, 0.9)"    // Tomato red for session images
                  : "rgba(138, 43, 226, 0.9)",  // Purple for library images
                color: "white",
                padding: "2px 6px",
                borderRadius: "8px",
                fontSize: "10px",
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
                zIndex: 1,
              }}
              aria-label={`AI Generated Image ${aiType ? `(${aiType})` : ''}`}
            >
              {aiType === 'session' ? 'NEW' : 'AI'}
            </div>
          )}

          {/* Selection number badge */}
          {isSelected(url) && (
            <div
              style={{
                position: "absolute",
                top: isAIGenerated ? "32px" : isLibrary ? "32px" : "8px",
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
                zIndex: 2,
              }}
            >
              {getSelectionNumber(url)}
            </div>
          )}

          {/* Selection overlay */}
          {isSelected(url) && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 128, 96, 0.1)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>

        {/* Publish and Remove buttons for library items */}
        {isLibrary && onPublishFromLibrary && onRemoveFromLibrary && (
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              gap: "4px",
            }}
          >
            <Button
              size="micro"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                onPublishFromLibrary(url);
              }}
              fullWidth
            >
              Publish
            </Button>
            <Button
              size="micro"
              tone="critical"
              variant="plain"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromLibrary(url);
              }}
              fullWidth
            >
              Remove
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Prepare library images for rendering
  const libraryImages = libraryItems?.map((item, index) => {
    const url = typeof item === "string" ? item : item.imageUrl;
    return {
      id: `library-${index}`,
      url,
      altText: "AI generated image (Library)",
      isAIGenerated: true,
    };
  }) || [];

  // Don't show generated images from current session in the selector
  // They're already displayed in the "Generated Images" section below
  const generatedImagesList: any[] = [];

  const totalImages = (media?.length || 0) + libraryImages.length;

  return (
    <>
      <InlineStack gap="400" align="space-between" wrap={false}>
        <Text as="h3" variant="headingMd">
          Select Source Images ({selectedImages.length} of {totalImages} selected)
        </Text>
        {selectedImages.length > 0 && (
          <Button variant="tertiary" size="slim" onClick={onClearSelection}>
            Clear Selection
          </Button>
        )}
      </InlineStack>

      <div
        style={{
          display: "flex",
          gap: "16px",
          overflowX: "auto",
          paddingBottom: "8px",
          minHeight: "120px",
          alignItems: "flex-start",
        }}
      >
        {/* Original product images */}
        {media?.map((m) => {
          if (!m.image?.url) return null;
          return renderImageItem(
            m.id,
            m.image.url,
            m.image.altText || undefined,
            false
          );
        })}

        {/* Library images (AI Generated) */}
        {libraryImages.map((item) =>
          renderImageItem(
            item.id,
            item.url,
            item.altText,
            item.isAIGenerated,
            'library',
            true
          )
        )}
      </div>
    </>
  );
}
