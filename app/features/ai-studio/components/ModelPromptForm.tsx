import { Button, InlineStack, Text, TextField } from "@shopify/polaris";
import { useState } from "react";

export function ModelPromptForm({
  disabled,
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: (prompt: string) => void;
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
      </InlineStack>
    </>
  );
}
