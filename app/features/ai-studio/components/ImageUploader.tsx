import { useState, useCallback, useEffect } from "react";
import {
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  DropZone,
  Thumbnail,
  ProgressBar,
  Banner,
} from "@shopify/polaris";

interface ImageUploaderProps {
  onUpload: (files: File[]) => Promise<void>;
  maxFiles?: number;
  maxSizeMB?: number;
}

export function ImageUploader({
  onUpload,
  maxFiles = 5,
  maxSizeMB = 10,
}: ImageUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [objectUrls, setObjectUrls] = useState<string[]>([]);

  // Clean up object URLs when component unmounts or files change
  useEffect(() => {
    // Create new object URLs for files
    const urls = files.map(file => URL.createObjectURL(file));
    setObjectUrls(urls);

    // Cleanup function to revoke old object URLs
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

  const handleDrop = useCallback(
    (_droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        setError("Some files were rejected. Please check file type and size.");
        return;
      }

      if (acceptedFiles.length + files.length > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate file sizes
      const oversized = acceptedFiles.filter(
        file => file.size > maxSizeMB * 1024 * 1024
      );

      if (oversized.length > 0) {
        setError(`Files must be under ${maxSizeMB}MB`);
        return;
      }

      setFiles(prev => [...prev, ...acceptedFiles]);
    },
    [files, maxFiles, maxSizeMB]
  );

  const handleRemove = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setError(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const totalFiles = files.length;

      // Upload files sequentially for better progress tracking
      for (let i = 0; i < totalFiles; i++) {
        await onUpload([files[i]]);
        // Update progress after each file
        setProgress(Math.round(((i + 1) / totalFiles) * 100));
      }

      // Success - clear files and reset
      setFiles([]);
      setProgress(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }, [files, onUpload]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Upload Images
        </Text>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        <DropZone
          accept="image/*"
          type="image"
          onDrop={handleDrop}
          allowMultiple
          disabled={uploading}
        >
          <DropZone.FileUpload
            actionTitle="Add images"
            actionHint={`or drop files to upload (max ${maxFiles} images, ${maxSizeMB}MB each)`}
          />
        </DropZone>

        {files.length > 0 && (
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </Text>

            <InlineStack gap="200" wrap>
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} style={{ position: 'relative' }}>
                  <Thumbnail
                    source={objectUrls[index]}
                    alt={file.name}
                    size="large"
                  />
                  {!uploading && (
                    <div style={{ marginTop: '4px' }}>
                      <Button
                        size="micro"
                        variant="plain"
                        tone="critical"
                        onClick={() => handleRemove(index)}
                        disabled={uploading}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </InlineStack>

            {uploading && (
              <BlockStack gap="200">
                <ProgressBar progress={progress} size="small" />
                <Text as="p" variant="bodySm" tone="subdued">
                  Uploading... {progress}%
                </Text>
              </BlockStack>
            )}

            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                loading={uploading}
              >
                Upload {files.length.toString()} image{files.length !== 1 ? 's' : ''}
              </Button>

              {!uploading && files.length > 0 && (
                <Button
                  variant="plain"
                  onClick={handleClearAll}
                  disabled={uploading}
                >
                  Clear all
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}