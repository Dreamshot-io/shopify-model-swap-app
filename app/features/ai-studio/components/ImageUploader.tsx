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
  Badge,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
} from "@shopify/polaris-icons";
import {
  getStagedUploadUrl,
  uploadToStagedUrl,
  completeUpload,
} from "../../../utils/shopify-upload";

interface ImageUploaderProps {
  productId: string;
  onSuccess?: (imageUrls: string[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

type FileStatus =
  | "pending"
  | "getting-url"
  | "uploading"
  | "finalizing"
  | "success"
  | "error";

interface FileWithStatus {
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
  imageUrl?: string;
}

export function ImageUploader({
  productId,
  onSuccess,
  maxFiles = 5,
  maxSizeMB = 20, // Increased to 20MB - Shopify's limit (no Vercel limit!)
}: ImageUploaderProps) {
  const [filesWithStatus, setFilesWithStatus] = useState<FileWithStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [objectUrls, setObjectUrls] = useState<string[]>([]);

  // Clean up object URLs when component unmounts or files change
  useEffect(() => {
    // Create new object URLs for files
    const urls = filesWithStatus.map(({ file }) => URL.createObjectURL(file));
    setObjectUrls(urls);

    // Cleanup function to revoke old object URLs
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [filesWithStatus]);

  const handleDrop = useCallback(
    (_droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        setError("Some files were rejected. Please check file type and size.");
        return;
      }

      if (acceptedFiles.length + filesWithStatus.length > maxFiles) {
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

      setFilesWithStatus(prev => [
        ...prev,
        ...acceptedFiles.map(file => ({
          file,
          status: "pending" as FileStatus,
          progress: 0,
        })),
      ]);
    },
    [filesWithStatus, maxFiles, maxSizeMB]
  );

  const handleRemove = useCallback((index: number) => {
    setFilesWithStatus(prev => prev.filter((_, i) => i !== index));
    setError(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setFilesWithStatus([]);
    setError(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (filesWithStatus.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    const totalFiles = filesWithStatus.length;
    let successCount = 0;
    let errorCount = 0;
    const uploadedUrls: string[] = [];

    console.log(`[UPLOAD:CLIENT] Starting batch upload of ${totalFiles} files`);

    // Upload files sequentially with 3-step flow
    for (let i = 0; i < totalFiles; i++) {
      const currentFile = filesWithStatus[i];
      console.log(`[UPLOAD:CLIENT] Processing file ${i + 1}/${totalFiles}: ${currentFile.file.name}`);

      try {
        // Step 1: Get staged upload URL
        setFilesWithStatus(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "getting-url" as FileStatus, progress: 0 } : f
          )
        );

        const stagedTarget = await getStagedUploadUrl(currentFile.file, productId);
        console.log(`[UPLOAD:CLIENT] ✓ Got staged URL for ${currentFile.file.name}`);

        // Step 2: Upload directly to Shopify S3 (bypasses Vercel!)
        setFilesWithStatus(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "uploading" as FileStatus } : f
          )
        );

        await uploadToStagedUrl(stagedTarget, currentFile.file, (uploadProgress) => {
          // Update per-file progress
          setFilesWithStatus(prev =>
            prev.map((f, idx) =>
              idx === i ? { ...f, progress: uploadProgress.percentage } : f
            )
          );
        });

        console.log(`[UPLOAD:CLIENT] ✓ Direct upload complete for ${currentFile.file.name}`);

        // Step 3: Finalize upload on server
        setFilesWithStatus(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "finalizing" as FileStatus, progress: 100 } : f
          )
        );

        const imageUrl = await completeUpload(
          stagedTarget.resourceUrl,
          currentFile.file.name,
          productId,
        );

        console.log(`[UPLOAD:CLIENT] ✓ Upload finalized for ${currentFile.file.name}`);

        // Mark as success
        setFilesWithStatus(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "success" as FileStatus, imageUrl, progress: 100 } : f
          )
        );

        uploadedUrls.push(imageUrl);
        successCount++;
      } catch (err) {
        // Mark as error but continue with remaining files
        const errorMsg = err instanceof Error ? err.message : "Upload failed";
        console.error(`[UPLOAD:CLIENT] ✗ Failed to upload ${currentFile.file.name}:`, err);

        setFilesWithStatus(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error" as FileStatus, error: errorMsg } : f
          )
        );
        errorCount++;
      }

      // Update overall progress
      setProgress(Math.round(((i + 1) / totalFiles) * 100));

      // Add delay between uploads
      if (i < totalFiles - 1) {
        console.log(`[UPLOAD:CLIENT] Waiting 500ms before next upload...`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    setUploading(false);

    // Notify parent of successful uploads
    if (uploadedUrls.length > 0 && onSuccess) {
      onSuccess(uploadedUrls);
    }

    // Show summary
    if (successCount === totalFiles) {
      // All succeeded - clear files after a short delay
      setTimeout(() => {
        setFilesWithStatus([]);
        setProgress(0);
      }, 2000);
    } else if (successCount > 0) {
      // Partial success
      setError(`${successCount} of ${totalFiles} files uploaded successfully. ${errorCount} failed.`);
    } else {
      // All failed
      setError("All uploads failed. Please try again.");
    }
  }, [filesWithStatus, productId, onSuccess]);

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
          accept="image/jpeg,image/png,image/webp"
          type="image"
          onDrop={handleDrop}
          allowMultiple
          disabled={uploading}
        >
          {filesWithStatus.length === 0 ? (
            <DropZone.FileUpload
              actionTitle="Add images"
              actionHint={`or drop files to upload (max ${maxFiles} images, ${maxSizeMB}MB each)`}
            />
          ) : (
            <BlockStack gap="400" align="center">
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  {filesWithStatus.length} file{filesWithStatus.length !== 1 ? 's' : ''} selected
                </Text>

                <InlineStack gap="200" wrap align="center">
                  {filesWithStatus.map(({ file, status, error: fileError, progress }, index) => (
                    <div key={`${file.name}-${index}`} style={{ position: 'relative' }}>
                      <BlockStack gap="100" align="center">
                        <div style={{ position: 'relative' }}>
                          <Thumbnail
                            source={objectUrls[index] || ""}
                            alt={file.name || "Uploaded image"}
                            size="large"
                          />
                          {/* Status badge overlay */}
                          {status !== "pending" && (
                            <div style={{
                              position: 'absolute',
                              top: '-8px',
                              right: '-8px',
                              zIndex: 1
                            }}>
                              {(status === "getting-url" || status === "finalizing") && (
                                <Badge tone="info">
                                  <Icon source={ClockIcon} />
                                </Badge>
                              )}
                              {status === "uploading" && (
                                <Badge tone="info">{progress}%</Badge>
                              )}
                              {status === "success" && (
                                <Badge tone="success">
                                  <Icon source={CheckCircleIcon} />
                                </Badge>
                              )}
                              {status === "error" && (
                                <Badge tone="critical">
                                  <Icon source={XCircleIcon} />
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        {!uploading && (
                          <div style={{ textAlign: 'center' }}>
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
                        {status === "error" && fileError && (
                          <Text as="p" variant="bodySm" tone="critical" alignment="center">
                            {fileError}
                          </Text>
                        )}
                        {status === "getting-url" && (
                          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                            Getting upload URL...
                          </Text>
                        )}
                        {status === "uploading" && (
                          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                            Uploading {progress}%
                          </Text>
                        )}
                        {status === "finalizing" && (
                          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                            Finalizing...
                          </Text>
                        )}
                      </BlockStack>
                    </div>
                  ))}
                </InlineStack>
              </BlockStack>
            </BlockStack>
          )}
        </DropZone>

        {/* Upload button and progress bar moved OUTSIDE the DropZone */}
        {filesWithStatus.length > 0 && (
          <BlockStack gap="300">
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
                disabled={filesWithStatus.length === 0 || uploading}
                loading={uploading}
              >
                Upload {filesWithStatus.length.toString()} image{filesWithStatus.length !== 1 ? 's' : ''}
              </Button>

              {!uploading && filesWithStatus.length > 0 && (
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
