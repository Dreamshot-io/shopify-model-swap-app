/**
 * Client-side utilities for direct upload to Shopify S3
 * Bypasses Vercel 4.5MB limit by uploading directly from browser to Shopify
 */

export interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

/**
 * Upload file directly to Shopify's staged S3 URL
 *
 * @param stagedTarget - Staged upload target from getStagedUpload
 * @param file - File to upload
 * @param onProgress - Progress callback (0-100)
 * @returns Promise that resolves when upload is complete
 */
export async function uploadToStagedUrl(
  stagedTarget: StagedUploadTarget,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
        }
      });
    }

    // Handle completion
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        console.log(
          `[SHOPIFY_UPLOAD] ✓ Direct upload complete (${xhr.status})`,
        );
        resolve();
      } else {
        console.error(
          `[SHOPIFY_UPLOAD] ✗ Upload failed (${xhr.status}):`,
          xhr.responseText,
        );
        reject(
          new Error(
            `Upload failed: ${xhr.status} ${xhr.statusText} - ${xhr.responseText}`,
          ),
        );
      }
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      console.error("[SHOPIFY_UPLOAD] ✗ Network error during upload");
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      console.error("[SHOPIFY_UPLOAD] ✗ Upload aborted");
      reject(new Error("Upload aborted"));
    });

    // Prepare FormData - IMPORTANT: Parameters must be in exact order
    const formData = new FormData();

    // Add parameters in the order returned by Shopify
    stagedTarget.parameters.forEach((param) => {
      formData.append(param.name, param.value);
    });

    // File must be added LAST
    formData.append("file", file);

    console.log("[SHOPIFY_UPLOAD] Starting direct upload to Shopify S3:", {
      url: stagedTarget.url,
      filename: file.name,
      size: file.size,
      sizeMB: (file.size / 1024 / 1024).toFixed(2),
      paramCount: stagedTarget.parameters.length,
    });

    // Start upload
    xhr.open("POST", stagedTarget.url);
    xhr.send(formData);
  });
}

/**
 * Get staged upload URL from server
 *
 * @param file - File to upload
 * @param productId - Product ID for metafield
 * @returns Staged upload target
 */
export async function getStagedUploadUrl(
  file: File,
  productId: string,
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<StagedUploadTarget> {
  console.log("[SHOPIFY_UPLOAD] Requesting staged upload URL:", {
    filename: file.name,
    size: file.size,
    type: file.type,
  });

  const formData = new FormData();
  formData.set("intent", "getStagedUpload");
  formData.set("filename", file.name);
  formData.set("mimeType", file.type);
  formData.set("fileSize", file.size.toString());
  formData.set("productId", productId);

  const response = await authenticatedFetch("/app/ai-studio", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to get staged upload URL: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.ok || !result.stagedTarget) {
    throw new Error(result.error || "Failed to get staged upload URL");
  }

  console.log("[SHOPIFY_UPLOAD] ✓ Got staged upload URL");

  return result.stagedTarget;
}

/**
 * Notify server that upload is complete
 *
 * @param resourceUrl - Resource URL from staged upload
 * @param filename - Original filename
 * @param productId - Product ID for metafield
 * @returns Image URL from Shopify
 */
export async function completeUpload(
  resourceUrl: string,
  filename: string,
  productId: string,
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  console.log("[SHOPIFY_UPLOAD] Notifying server of upload completion");

  const formData = new FormData();
  formData.set("intent", "completeUpload");
  formData.set("resourceUrl", resourceUrl);
  formData.set("filename", filename);
  formData.set("productId", productId);

  const response = await authenticatedFetch("/app/ai-studio", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to complete upload: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.ok || !result.imageUrl) {
    throw new Error(result.error || "Failed to complete upload");
  }

  console.log(
    "[SHOPIFY_UPLOAD] ✓ Upload finalized:",
    result.imageUrl,
  );

  return result.imageUrl;
}
