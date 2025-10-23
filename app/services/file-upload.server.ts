import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// Type Definitions

interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

interface UploadOptions {
  filename: string;
  mimeType: string;
  fileSize: number;
  altText?: string;
}

interface UploadedFile {
  id: string;
  url: string;
  altText: string | null;
}

// Constants

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 1000;

/**
 * Step 1: Create staged upload target
 *
 * Creates a staged upload URL in Shopify's file library where the file will be uploaded.
 * Uses resource type "IMAGE" for generic file library storage (compatible with fileCreate mutation).
 *
 * Note: Shopify resource types and their compatible mutations:
 * - "IMAGE" → fileCreate (generic file library) - USED HERE
 * - "PRODUCT_IMAGE" → productCreateMedia (direct product attachment)
 * - "VIDEO" → fileCreate (generic file library)
 * - "COLLECTION_IMAGE" → collectionUpdate (collection images)
 *
 * This is the first step in Shopify's 3-step file upload process.
 *
 * EXPORTED for client-side direct upload pattern (bypasses Vercel 4.5MB limit).
 *
 * @param admin - Shopify Admin API context
 * @param options - Upload options including filename, mime type, and file size
 * @returns Staged upload target with URL and parameters
 * @throws Error if staged upload creation fails or returns user errors
 */
export async function createStagedUpload(
  admin: AdminApiContext,
  options: UploadOptions,
): Promise<StagedUploadTarget> {
  const mutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  console.log("[CREATE_STAGED_UPLOAD] Requesting staged upload:", {
    filename: options.filename,
    mimeType: options.mimeType,
    fileSize: options.fileSize,
    fileSizeMB: (options.fileSize / 1024 / 1024).toFixed(2),
  });

  const response = await admin.graphql(mutation, {
    variables: {
      input: [
        {
          filename: options.filename,
          mimeType: options.mimeType,
          resource: "IMAGE",
          fileSize: options.fileSize.toString(),
          httpMethod: "POST",
        },
      ],
    },
  });

  const result = await response.json();
  
  console.log("[CREATE_STAGED_UPLOAD] GraphQL response:", {
    hasData: !!result.data,
    hasStagedUploadsCreate: !!result.data?.stagedUploadsCreate,
    hasUserErrors: !!result.data?.stagedUploadsCreate?.userErrors?.length,
    hasStagedTargets: !!result.data?.stagedUploadsCreate?.stagedTargets?.length,
    userErrors: result.data?.stagedUploadsCreate?.userErrors,
    stagedTargets: result.data?.stagedUploadsCreate?.stagedTargets,
  });

  if (result.data?.stagedUploadsCreate?.userErrors?.length > 0) {
    const error = result.data.stagedUploadsCreate.userErrors[0];
    console.error("[CREATE_STAGED_UPLOAD] User error:", error);
    throw new Error(
      `Failed to create staged upload: ${error.message} (${error.field})`,
    );
  }

  const stagedTarget = result.data?.stagedUploadsCreate?.stagedTargets?.[0];

  if (!stagedTarget) {
    console.error("[CREATE_STAGED_UPLOAD] No staged target returned:", result);
    throw new Error(
      "Failed to create staged upload: No staged target returned",
    );
  }

  console.log("[CREATE_STAGED_UPLOAD] ✓ Success:", {
    url: stagedTarget.url,
    resourceUrl: stagedTarget.resourceUrl,
    paramCount: stagedTarget.parameters.length,
  });

  return stagedTarget;
}

/**
 * Step 2: Upload file to staged URL
 *
 * Uploads the actual file to the staged URL created in step 1.
 * IMPORTANT: Parameters must be added in the exact order returned by Shopify,
 * and the file must be appended last.
 *
 * @param url - Staged upload URL from step 1
 * @param file - File object to upload
 * @param parameters - Parameters from staged upload (must be in correct order)
 * @throws Error if upload fails or returns non-200 status
 */
async function uploadToStagedUrl(
  url: string,
  file: File,
  parameters: Array<{ name: string; value: string }>,
): Promise<void> {
  const formData = new FormData();

  // IMPORTANT: Parameters must be added in order
  parameters.forEach((param) => {
    formData.append(param.name, param.value);
  });

  // File must be added last
  formData.append("file", file);

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Upload to staged URL failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }
}

/**
 * Step 3: Create file asset in Shopify
 *
 * Creates a file asset in Shopify using the resource URL from the staged upload.
 * This registers the uploaded file in Shopify's file system.
 *
 * @param admin - Shopify Admin API context
 * @param resourceUrl - Resource URL from staged upload
 * @param filename - Original filename
 * @param altText - Optional alt text for the image
 * @returns Object containing the created file's ID
 * @throws Error if file creation fails or returns user errors
 */
async function createFileAsset(
  admin: AdminApiContext,
  resourceUrl: string,
  filename: string,
  altText?: string,
): Promise<{ id: string }> {
  const mutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          ... on MediaImage {
            id
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: {
      files: [
        {
          originalSource: resourceUrl,
          contentType: "IMAGE",
          alt: altText || filename,
        },
      ],
    },
  });

  const result = await response.json();

  if (result.data?.fileCreate?.userErrors?.length > 0) {
    const error = result.data.fileCreate.userErrors[0];
    throw new Error(
      `Failed to create file asset: ${error.message} (${error.field})`,
    );
  }

  const file = result.data?.fileCreate?.files?.[0];

  if (!file) {
    throw new Error("Failed to create file asset: No file returned");
  }

  return { id: file.id };
}

/**
 * Step 4: Poll for file processing completion
 *
 * Polls Shopify's API to check if the uploaded file has been processed.
 * Files go through processing stages (UPLOADING -> PROCESSING -> READY/FAILED).
 *
 * Adds deadline-based timeout and exponential backoff for serverless safety.
 */
async function pollFileProcessing(
  admin: AdminApiContext,
  fileId: string,
  maxAttempts = MAX_POLL_ATTEMPTS,
  delayMs = POLL_DELAY_MS,
): Promise<UploadedFile> {
  const query = `
    query getFile($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          id
          status
          image {
            url
            altText
          }
        }
      }
    }
  `;

  const start = Date.now();
  const deadlineMs = Math.min(
    Number(process.env.FILE_UPLOAD_POLL_DEADLINE_MS || 25000),
    30000,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() - start > deadlineMs) {
      throw new Error(
        `File processing exceeded deadline (${deadlineMs}ms). File ID: ${fileId}`,
      );
    }

    const response = await admin.graphql(query, {
      variables: { id: fileId },
    });

    const result = await response.json();
    const file = result.data?.node;

    if (file?.status === "READY" && file?.image?.url) {
      return {
        id: file.id,
        url: file.image.url,
        altText: file.image.altText,
      };
    }

    if (file?.status === "FAILED") {
      throw new Error(
        `File processing failed for file ID: ${fileId}. ` +
          `The file may be corrupted or in an unsupported format.`,
      );
    }

    const backoff = Math.min(delayMs * Math.pow(1.5, attempt), 4000);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  throw new Error(
    `File processing timeout after ${maxAttempts} attempts. ` +
      `File ID: ${fileId}. The file may still be processing.`,
  );
}

/**
 * Finalize Shopify upload after client has uploaded directly to S3
 *
 * Steps 3-4: Create file asset and poll for processing completion.
 * Used in client-side direct upload pattern to bypass Vercel 4.5MB limit.
 *
 * @param admin - Shopify Admin API context
 * @param resourceUrl - Resource URL from staged upload
 * @param filename - Original filename
 * @param altText - Optional alt text
 * @returns Uploaded file info with Shopify URL
 */
export async function finalizeShopifyUpload(
  admin: AdminApiContext,
  resourceUrl: string,
  filename: string,
  altText?: string,
): Promise<UploadedFile> {
  console.log(`[file-upload] Finalizing upload for: ${filename}`);
  console.log(`[file-upload] Resource URL: ${resourceUrl}`);

  // Step 3: Create file asset
  console.log(`[file-upload] Creating file asset: ${filename}`);
  const fileAsset = await createFileAsset(
    admin,
    resourceUrl,
    filename,
    altText,
  );

  // Step 4: Poll for completion
  console.log(`[file-upload] Polling for completion: ${fileAsset.id}`);
  const uploadedFile = await pollFileProcessing(admin, fileAsset.id);

  console.log(`[file-upload] Finalization complete: ${uploadedFile.url}`);
  return uploadedFile;
}

/**
 * Main upload function - orchestrates all steps
 *
 * @deprecated Use createStagedUpload + client upload + finalizeShopifyUpload for files > 4.5MB
 * This function uploads through Vercel and is limited to 4.5MB by Vercel serverless constraints.
 */
export async function uploadImageToShopify(
  admin: AdminApiContext,
  file: File,
  altText?: string,
): Promise<UploadedFile> {
  // Validation
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. ` +
        `Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
    );
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid file type: ${file.type}. ` +
        `Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}.`,
    );
  }

  try {
    // Step 1: Create staged upload
    console.log(`[file-upload] Creating staged upload for: ${file.name}`);
    const stagedTarget = await createStagedUpload(admin, {
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      altText,
    });

    // Step 2: Upload file
    console.log(`[file-upload] Uploading to staged URL: ${file.name}`);
    await uploadToStagedUrl(
      stagedTarget.url,
      file,
      stagedTarget.parameters,
    );

    // Step 3: Create file asset
    console.log(`[file-upload] Creating file asset: ${file.name}`);
    const fileAsset = await createFileAsset(
      admin,
      stagedTarget.resourceUrl,
      file.name,
      altText,
    );

    // Step 4: Poll for completion
    console.log(`[file-upload] Polling for completion: ${fileAsset.id}`);
    const uploadedFile = await pollFileProcessing(admin, fileAsset.id);

    console.log(`[file-upload] Upload complete: ${uploadedFile.url}`);
    return uploadedFile;
  } catch (error) {
    console.error("[file-upload] File upload failed:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`File upload failed: ${String(error)}`);
  }
}

// Export types for use in other modules
export type { StagedUploadTarget, UploadOptions, UploadedFile };
