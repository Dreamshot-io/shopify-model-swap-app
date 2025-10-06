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

// Debug version with enhanced logging
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
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // Enhanced debugging function
  const addDebugInfo = useCallback((info: string) => {
    console.log(`[ImageUploader Debug] ${info}`);
    setDebugInfo(prev => [...prev, `${new Date().toISOString()}: ${info}`]);
  }, []);

  // Clean up object URLs when component unmounts or files change
  useEffect(() => {
    addDebugInfo(`Creating object URLs for ${files.length} files`);

    // Create new object URLs for files
    const urls = files.map(file => {
      const url = URL.createObjectURL(file);
      addDebugInfo(`Created object URL for ${file.name}: ${url}`);
      return url;
    });
    setObjectUrls(urls);

    // Cleanup function to revoke old object URLs
    return () => {
      urls.forEach(url => {
        URL.revokeObjectURL(url);
        addDebugInfo(`Revoked object URL: ${url}`);
      });
    };
  }, [files, addDebugInfo]);

  const handleDrop = useCallback(
    (_droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      addDebugInfo(`Files dropped - accepted: ${acceptedFiles.length}, rejected: ${rejectedFiles.length}`);
      setError(null);

      if (rejectedFiles.length > 0) {
        const errorMsg = "Some files were rejected. Please check file type and size.";
        addDebugInfo(`Error: ${errorMsg}`);
        rejectedFiles.forEach(file => {
          addDebugInfo(`Rejected file: ${file.name} (${file.type}, ${file.size} bytes)`);
        });
        setError(errorMsg);
        return;
      }

      if (acceptedFiles.length + files.length > maxFiles) {
        const errorMsg = `Maximum ${maxFiles} files allowed`;
        addDebugInfo(`Error: ${errorMsg}`);
        setError(errorMsg);
        return;
      }

      // Validate file sizes
      const oversized = acceptedFiles.filter(
        file => file.size > maxSizeMB * 1024 * 1024
      );

      if (oversized.length > 0) {
        const errorMsg = `Files must be under ${maxSizeMB}MB`;
        addDebugInfo(`Error: ${errorMsg}`);
        oversized.forEach(file => {
          addDebugInfo(`Oversized file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        });
        setError(errorMsg);
        return;
      }

      // Log accepted files
      acceptedFiles.forEach(file => {
        addDebugInfo(`Accepted file: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(2)}KB)`);
      });

      setFiles(prev => [...prev, ...acceptedFiles]);
    },
    [files, maxFiles, maxSizeMB, addDebugInfo]
  );

  const handleRemove = useCallback((index: number) => {
    const removedFile = files[index];
    addDebugInfo(`Removing file: ${removedFile?.name}`);
    setFiles(prev => prev.filter((_, i) => i !== index));
    setError(null);
  }, [files, addDebugInfo]);

  const handleClearAll = useCallback(() => {
    addDebugInfo(`Clearing all ${files.length} files`);
    setFiles([]);
    setError(null);
  }, [files.length, addDebugInfo]);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) {
      addDebugInfo("No files to upload");
      return;
    }

    addDebugInfo(`Starting upload for ${files.length} files`);
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const totalFiles = files.length;

      // Upload files sequentially for better progress tracking
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        addDebugInfo(`Uploading file ${i + 1}/${totalFiles}: ${file.name}`);

        try {
          await onUpload([file]);
          addDebugInfo(`Successfully uploaded: ${file.name}`);
        } catch (err) {
          addDebugInfo(`Failed to upload ${file.name}: ${err}`);
          throw err;
        }

        // Update progress after each file
        const progressValue = Math.round(((i + 1) / totalFiles) * 100);
        setProgress(progressValue);
        addDebugInfo(`Progress: ${progressValue}%`);
      }

      // Success - clear files and reset
      addDebugInfo("All files uploaded successfully!");
      setFiles([]);
      setProgress(0);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";
      addDebugInfo(`Upload error: ${errorMessage}`);
      setError(errorMessage);
      setProgress(0);
    } finally {
      setUploading(false);
      addDebugInfo("Upload process completed");
    }
  }, [files, onUpload, addDebugInfo]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Upload Images (Debug Mode)
        </Text>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        {/* Debug info section */}
        {debugInfo.length > 0 && (
          <Card sectioned>
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">Debug Log:</Text>
              <div style={{ maxHeight: '200px', overflow: 'auto', fontSize: '12px', fontFamily: 'monospace' }}>
                {debugInfo.slice(-10).map((info, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>{info}</div>
                ))}
              </div>
            </BlockStack>
          </Card>
        )}

        <DropZone
          accept="image/jpeg,image/png,image/webp"
          type="image"
          onDrop={handleDrop}
          allowMultiple
          disabled={uploading}
          onDropAccepted={(files) => addDebugInfo(`Drop accepted: ${files.length} files`)}
          onDropRejected={(files) => addDebugInfo(`Drop rejected: ${files.length} files`)}
          onFileDialogCancel={() => addDebugInfo("File dialog cancelled")}
        >
          {files.length === 0 ? (
            <DropZone.FileUpload
              actionTitle="Add images"
              actionHint={`or drop files to upload (max ${maxFiles} images, ${maxSizeMB}MB each)`}
            />
          ) : (
            <BlockStack gap="400" align="center">
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  {files.length} file{files.length !== 1 ? 's' : ''} selected
                </Text>

                <InlineStack gap="200" wrap align="center">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} style={{ position: 'relative' }}>
                      <Thumbnail
                        source={objectUrls[index]}
                        alt={file.name}
                        size="large"
                      />
                      <div style={{ fontSize: '10px', textAlign: 'center', marginTop: '2px' }}>
                        {file.name} ({(file.size / 1024).toFixed(0)}KB)
                      </div>
                      {!uploading && (
                        <div style={{ marginTop: '4px', textAlign: 'center' }}>
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
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      Uploading... {progress}%
                    </Text>
                  </BlockStack>
                )}

                <InlineStack gap="200" align="center">
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

                  <Button
                    variant="plain"
                    onClick={() => setDebugInfo([])}
                  >
                    Clear debug log
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          )}
        </DropZone>

        {/* File type info */}
        <Text as="p" variant="bodySm" tone="subdued">
          Accepted formats: JPEG, PNG, WebP. Max file size: {maxSizeMB}MB per file.
        </Text>
      </BlockStack>
    </Card>
  );
}