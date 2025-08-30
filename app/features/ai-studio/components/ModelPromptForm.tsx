import { Button, InlineStack, Text, TextField } from "@shopify/polaris";
import { useState } from "react";

export function ModelPromptForm({
  disabled,
  onGenerate,
  onQuickDemo,
  onTestProvider,
}: {
  disabled: boolean;
  onGenerate: (prompt: string) => void;
  onQuickDemo: () => void;
  onTestProvider: (prompt: string) => Promise<void> | void;
}) {
  const [modelPrompt, setModelPrompt] = useState("");

  return (
    <>
      <Text as="h3" variant="headingMd">
        Model Description
      </Text>
      <TextField
        label="Describe the model you want"
        value={modelPrompt}
        onChange={setModelPrompt}
        placeholder="e.g., ginger woman, black male model, blonde model, elderly person..."
        multiline={3}
        helpText="Describe the person you want to see wearing this product"
        autoComplete="off"
      />
      <InlineStack gap="300" wrap={false}>
        <Button
          variant="primary"
          size="large"
          onClick={() => onGenerate(modelPrompt)}
          disabled={disabled || !modelPrompt.trim()}
        >
          🎭 Generate AI Images
        </Button>
        <Button onClick={onQuickDemo}>🧪 Quick Demo</Button>
        <Button
          onClick={() => onTestProvider(modelPrompt)}
          disabled={disabled || !modelPrompt.trim()}
        >
          🤖 Test AI Provider
        </Button>
      </InlineStack>
    </>
  );
}
