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
  timeoutMs = 120000, // 2 minute timeout for large files
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Set timeout to prevent hanging requests
    xhr.timeout = timeoutMs;

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
      reject(new Error("Network error during upload. Please check your internet connection and try again."));
    });

    xhr.addEventListener("timeout", () => {
      console.error("[SHOPIFY_UPLOAD] ✗ Upload timed out");
      reject(new Error(`Upload timed out after ${timeoutMs / 1000} seconds. The file may be too large or your connection too slow.`));
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

  console.log("[SHOPIFY_UPLOAD] Sending request with FormData:", {
    intent: formData.get("intent"),
    filename: formData.get("filename"),
    mimeType: formData.get("mimeType"),
    fileSize: formData.get("fileSize"),
    productId: formData.get("productId"),
  });

  let response: Response;
  try {
    response = await authenticatedFetch("/app/api/ai-studio/get-staged-upload", {
      method: "POST",
      body: formData,
      // Don't set Content-Type header - let browser set it with boundary for FormData
    });
  } catch (fetchError) {
    console.error("[SHOPIFY_UPLOAD] ✗ Network error getting staged URL:", fetchError);
    throw new Error("Network error while preparing upload. Please check your connection and try again.");
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[SHOPIFY_UPLOAD] ✗ Server error getting staged URL:", response.status, errorText);
    throw new Error(`Failed to prepare upload (${response.status}): ${response.statusText || "Server error"}. Please try again.`);
  }

  let result;
  try {
    result = await response.json();
  } catch (parseError) {
    console.error("[SHOPIFY_UPLOAD] ✗ Failed to parse staged upload response:", parseError);
    throw new Error("Invalid response from server. Please try again.");
  }

  if (!result.ok || !result.stagedTarget) {
    throw new Error(result.error || "Failed to get staged upload URL. Please try again.");
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

  let response: Response;
  try {
    response = await authenticatedFetch("/app/api/ai-studio/complete-upload", {
      method: "POST",
      body: formData,
    });
  } catch (fetchError) {
    console.error("[SHOPIFY_UPLOAD] ✗ Network error completing upload:", fetchError);
    throw new Error("Network error while finalizing upload. The image may still be processing - please refresh and check your library.");
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[SHOPIFY_UPLOAD] ✗ Server error completing upload:", response.status, errorText);
    if (response.status === 504) {
      throw new Error("Server timed out while processing your image. Please wait a moment and check your library - the image may still appear.");
    }
    throw new Error(`Failed to finalize upload (${response.status}): ${response.statusText || "Server error"}. Please try again.`);
  }

  let result;
  try {
    result = await response.json();
  } catch (parseError) {
    console.error("[SHOPIFY_UPLOAD] ✗ Failed to parse complete upload response:", parseError);
    throw new Error("Invalid response from server while finalizing. Please check your library.");
  }

  if (!result.ok || !result.imageUrl) {
    throw new Error(result.error || "Failed to complete upload. Please try again.");
  }

  console.log(
    "[SHOPIFY_UPLOAD] ✓ Upload finalized:",
    result.imageUrl,
  );

  return result.imageUrl;
}
