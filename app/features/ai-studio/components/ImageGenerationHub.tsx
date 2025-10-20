import { useState, useCallback } from "react";
import { Card, Tabs, BlockStack } from "@shopify/polaris";
import { ImageSelector } from "./ImageSelector";
import { ModelPromptForm } from "./ModelPromptForm";
import { GeneratedImagesGrid } from "./GeneratedImagesGrid";
import { ImageUploader } from "./ImageUploader";
import type {
  LibraryItem,
  GeneratedImage,
  SelectedImage,
  BatchProcessingState,
} from "../types";

interface MediaNode {
  id: string;
  image?: { url?: string; altText?: string } | null;
}

interface ImageGenerationHubProps {
  productId: string;
  media: MediaNode[];
  selectedImages: SelectedImage[];
  generatedImages: GeneratedImage[];
  libraryItems: LibraryItem[];
  batchProcessingState: BatchProcessingState;
  onImageSelect: (image: SelectedImage) => void;
  onClearSelection: () => void;
  onGenerate: (prompt: string) => Promise<void>;
  onPublish: (img: GeneratedImage) => void;
  onSaveToLibrary: (img: GeneratedImage) => void;
  onPreview: (img: GeneratedImage) => void;
  onPublishFromLibrary: (url: string) => void;
  onPreviewLibrary: (url: string, base: string | null) => void;
  onRemoveFromLibrary: (url: string) => void;
  onUploadSuccess: (imageUrls: string[]) => void;
  isBusy: boolean;
  pendingAction: string | null;
}

export function ImageGenerationHub({
  productId,
  media,
  selectedImages,
  generatedImages,
  libraryItems,
  batchProcessingState,
  onImageSelect,
  onClearSelection,
  onGenerate,
  onPublish,
  onSaveToLibrary,
  onPreview,
  onPublishFromLibrary,
  onPreviewLibrary,
  onRemoveFromLibrary,
  onUploadSuccess,
  isBusy,
  pendingAction,
}: ImageGenerationHubProps) {
  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = useCallback(
    (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
    [],
  );

  const tabs = [
    {
      id: "ai-generation",
      content: "AI Generation",
      panelID: "ai-generation-panel",
    },
    {
      id: "manual-upload",
      content: "Manual Upload",
      panelID: "manual-upload-panel",
    },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
          {selectedTab === 0 && (
            <BlockStack gap="500">
              <ImageSelector
                media={media}
                libraryItems={libraryItems}
                generatedImages={generatedImages}
                selectedImages={selectedImages}
                onSelect={onImageSelect}
                onClearSelection={onClearSelection}
              />

              <ModelPromptForm
                disabled={selectedImages.length === 0}
                selectedImageCount={selectedImages.length}
                batchProcessingState={batchProcessingState}
                onGenerate={onGenerate}
              />

              <GeneratedImagesGrid
                images={generatedImages}
                onPublish={onPublish}
                onSaveToLibrary={onSaveToLibrary}
                onPreview={onPreview}
                isBusy={
                  pendingAction === "publish" ||
                  pendingAction === "saveToLibrary"
                }
              />
            </BlockStack>
          )}

          {selectedTab === 1 && (
            <BlockStack gap="400">
              <ImageUploader
                productId={productId}
                onSuccess={onUploadSuccess}
                maxFiles={5}
                maxSizeMB={20}
              />
            </BlockStack>
          )}
        </Tabs>
      </BlockStack>
    </Card>
  );
}
