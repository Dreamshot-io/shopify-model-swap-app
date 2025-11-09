import {
  Button,
  InlineStack,
  Text,
  TextField,
  ProgressBar,
  BlockStack,
  Badge,
  Select
} from "@shopify/polaris";
import { useState } from "react";
import type { BatchProcessingState } from "../types";
import type { AspectRatio } from "~/services/ai-providers";

export function ModelPromptForm({
  disabled,
  selectedImageCount,
  batchProcessingState,
  onGenerate,
}: {
  disabled: boolean;
  selectedImageCount: number;
  batchProcessingState?: BatchProcessingState;
  onGenerate: (prompt: string, aspectRatio: AspectRatio) => void;
}) {
  const [modelPrompt, setModelPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("match_input_image");

  const getProgressText = () => {
    if (!batchProcessingState?.isProcessing) return "";
    
    const { currentIndex, totalImages, completedImages, failedImages } = batchProcessingState;
    const completed = completedImages.length;
    const failed = failedImages.length;
    
    return `Processing ${currentIndex + 1} of ${totalImages} images (${completed} completed, ${failed} failed)`;
  };

  const getButtonText = () => {
    if (batchProcessingState?.isProcessing) {
      return "🔄 Generating...";
    }
    
    if (selectedImageCount === 0) {
      return "🎭 Generate AI Images";
    } else if (selectedImageCount === 1) {
      return "🎭 Generate AI Image";
    } else {
      return `🎭 Generate ${selectedImageCount} AI Images`;
    }
  };

  return (
    <BlockStack gap="300">
      <InlineStack gap="300" align="space-between" wrap={false}>
        <Text as="h3" variant="headingMd">
          Model Description
        </Text>
        {selectedImageCount > 0 && (
          <Badge tone="info">
            {selectedImageCount} image{selectedImageCount !== 1 ? "s" : ""} selected
          </Badge>
        )}
      </InlineStack>
      
      <TextField
        label="Describe the model you want"
        value={modelPrompt}
        onChange={setModelPrompt}
        placeholder="e.g., ginger woman, black male model, blonde model, elderly person..."
        multiline={3}
        helpText={
          selectedImageCount > 1
            ? `This prompt will be applied to all ${selectedImageCount} selected images`
            : "Describe the person you want to see wearing this product"
        }
        autoComplete="off"
        disabled={batchProcessingState?.isProcessing}
      />

      <Select
        label="Aspect Ratio"
        options={[
          { label: "Match Input Image", value: "match_input_image" },
          { label: "16:9 (Widescreen)", value: "16:9" },
          { label: "4:3 (Standard)", value: "4:3" },
          { label: "3:2 (Classic Photo)", value: "3:2" },
          { label: "1:1 (Square)", value: "1:1" },
          { label: "2:3 (Portrait)", value: "2:3" },
          { label: "3:4 (Portrait)", value: "3:4" },
          { label: "9:16 (Vertical)", value: "9:16" },
        ]}
        value={aspectRatio}
        onChange={(value) => setAspectRatio(value as AspectRatio)}
        disabled={batchProcessingState?.isProcessing}
        helpText="Choose the aspect ratio for the generated images"
      />

      {batchProcessingState?.isProcessing && (
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {getProgressText()}
          </Text>
          <ProgressBar 
            progress={
              ((batchProcessingState.completedImages.length + batchProcessingState.failedImages.length) 
              / batchProcessingState.totalImages) * 100
            }
            size="small"
          />
        </BlockStack>
      )}

      <InlineStack gap="300" wrap={false}>
        <Button
          variant="primary"
          size="large"
          onClick={() => onGenerate(modelPrompt, aspectRatio)}
          disabled={
            disabled ||
            !modelPrompt.trim() ||
            selectedImageCount === 0 ||
            batchProcessingState?.isProcessing
          }
          loading={batchProcessingState?.isProcessing}
        >
          {getButtonText()}
        </Button>
        
        {selectedImageCount > 1 && !batchProcessingState?.isProcessing && (
          <Text as="p" variant="bodySm" tone="subdued">
            Images will be processed sequentially
          </Text>
        )}
      </InlineStack>
    </BlockStack>
  );
}
