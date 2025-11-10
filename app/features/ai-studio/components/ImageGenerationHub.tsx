import { useState, useCallback } from "react";
import { BlockStack } from "@shopify/polaris";
import { ImageSelector } from "./ImageSelector";
import { ModelPromptForm } from "./ModelPromptForm";
import { GeneratedImagesGrid } from "./GeneratedImagesGrid";
import { ImageUploader } from "./ImageUploader";
import { GenerationModeTabs } from "./GenerationModeTabs";
import type {
  LibraryItem,
  GeneratedImage,
  SelectedImage,
  BatchProcessingState,
} from "../types";
import type { AspectRatio } from "../../../services/ai-providers";

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
  onGenerate: (prompt: string, aspectRatio: AspectRatio, imageCount: number) => Promise<void>;
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
  const [currentMode, setCurrentMode] = useState<'ai-generation' | 'manual-upload'>('ai-generation');

  const handleModeChange = useCallback(
    (mode: 'ai-generation' | 'manual-upload') => setCurrentMode(mode),
    [],
  );

  return (
    <>
      <GenerationModeTabs currentMode={currentMode} onModeChange={handleModeChange} />
      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E1E3E5',
          borderRadius: 0,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ padding: '20px' }}>
          <BlockStack gap="300">
            {currentMode === 'ai-generation' && (
              <BlockStack gap="300">
                <ImageSelector
                  media={media}
                  libraryItems={libraryItems}
                  generatedImages={generatedImages}
                  selectedImages={selectedImages}
                  onSelect={onImageSelect}
                  onClearSelection={onClearSelection}
                  onPublishFromLibrary={onPublishFromLibrary}
                  onRemoveFromLibrary={onRemoveFromLibrary}
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

            {currentMode === 'manual-upload' && (
              <BlockStack gap="300">
                <ImageUploader
                  productId={productId}
                  onSuccess={onUploadSuccess}
                  maxFiles={5}
                  maxSizeMB={20}
                />
              </BlockStack>
            )}
          </BlockStack>
        </div>
      </div>
    </>
  );
}
