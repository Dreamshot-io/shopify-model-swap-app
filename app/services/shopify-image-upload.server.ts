import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { createStagedUpload, finalizeShopifyUpload } from './file-upload.server';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize S3 client for R2
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

/**
 * Extract bucket and key from R2 URL
 */
function parseR2Url(r2Url: string): { bucket: string; key: string } {
  // URL format: https://account.r2.cloudflarestorage.com/bucket/key
  const urlParts = r2Url.replace('https://', '').split('/');
  const bucket = urlParts[1]; // First part after domain is bucket
  const key = urlParts.slice(2).join('/'); // Rest is the key
  return { bucket, key };
}

/**
 * Download image from R2 and upload to Shopify
 * Converts private R2 URLs to public Shopify CDN URLs
 */
export async function uploadR2ImageToShopify(
  admin: AdminApiContext,
  r2Url: string,
  filename: string
): Promise<string> {
  try {
    console.log(`[uploadR2ImageToShopify] Starting transfer from R2 to Shopify`);
    console.log(`[uploadR2ImageToShopify] R2 URL: ${r2Url.substring(0, 100)}...`);
    console.log(`[uploadR2ImageToShopify] Filename: ${filename}`);

    // Parse R2 URL to get bucket and key
    const { bucket, key } = parseR2Url(r2Url);
    console.log(`[uploadR2ImageToShopify] Bucket: ${bucket}, Key: ${key}`);

    // Step 1: Download image from R2 using S3 client
    console.log(`[uploadR2ImageToShopify] Downloading from R2 with S3 client...`);

    let buffer: Buffer;
    let mimeType = 'image/jpeg';

    try {
      // Use S3 GetObject to download from R2
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(getObjectCommand);

      if (!response.Body) {
        throw new Error('No body in R2 response');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);

      // Get content type
      mimeType = response.ContentType || 'image/jpeg';
      console.log(`[uploadR2ImageToShopify] Downloaded ${buffer.length} bytes, type: ${mimeType}`);

    } catch (s3Error) {
      console.error('[uploadR2ImageToShopify] S3 download failed, trying signed URL fallback:', s3Error);

      // Fallback: try with signed URL
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      const imageResponse = await fetch(signedUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download from R2: ${imageResponse.status}`);
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    }

    const fileSize = buffer.length;

    console.log(`[uploadR2ImageToShopify] Downloaded ${fileSize} bytes, type: ${mimeType}`);

    // Step 2: Create staged upload target
    console.log(`[uploadR2ImageToShopify] Creating staged upload...`);
    const stagedTarget = await createStagedUpload(admin, {
      filename: `${filename}.jpg`,
      mimeType,
      fileSize,
    });

    console.log(`[uploadR2ImageToShopify] Staged URL: ${stagedTarget.url}`);
    console.log(`[uploadR2ImageToShopify] Resource URL: ${stagedTarget.resourceUrl}`);

    // Step 3: Upload to Shopify's S3
    console.log(`[uploadR2ImageToShopify] Uploading to Shopify S3...`);
    const formData = new FormData();

    // Add parameters in order (critical for S3)
    stagedTarget.parameters.forEach((param) => {
      formData.append(param.name, param.value);
    });

    // Convert buffer to blob and append as file (must be last)
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, `${filename}.jpg`);

    const uploadResponse = await fetch(stagedTarget.url, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text().catch(() => 'Unknown error');
      throw new Error(`Upload to staged URL failed: ${uploadResponse.status} - ${errorText}`);
    }

    console.log(`[uploadR2ImageToShopify] Upload successful`);

    // Step 4: Finalize and get Shopify CDN URL
    console.log(`[uploadR2ImageToShopify] Finalizing upload...`);
    const uploadedFile = await finalizeShopifyUpload(
      admin,
      stagedTarget.resourceUrl,
      `${filename}.jpg`,
      `Base image ${filename}`
    );

    console.log(`[uploadR2ImageToShopify] ✓ Complete! Shopify URL: ${uploadedFile.url}`);
    return uploadedFile.url;

  } catch (error) {
    console.error('[uploadR2ImageToShopify] Failed:', error);
    throw new Error(`R2 to Shopify upload failed: ${(error as Error).message}`);
  }
}

/**
 * Process array in chunks with concurrency limit
 */
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 3
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => processor(item))
    );
    results.push(...batchResults);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Upload multiple R2 images to Shopify with concurrency limits
 * Processes in batches of 3 to avoid overwhelming Shopify API
 */
export async function uploadR2ImagesBatch(
  admin: AdminApiContext,
  images: Array<{ r2Url: string; filename: string }>
): Promise<string[]> {
  console.log(`[uploadR2ImagesBatch] Processing ${images.length} images with concurrency limit`);

  try {
    const results = await processInBatches(
      images,
      async (img, index = images.indexOf(img)) => {
        return uploadR2ImageToShopify(admin, img.r2Url, `${img.filename}-${index}`);
      },
      3 // Process max 3 images concurrently
    );

    console.log(`[uploadR2ImagesBatch] ✓ All ${results.length} images uploaded`);
    return results;
  } catch (error) {
    console.error('[uploadR2ImagesBatch] Batch upload failed:', error);
    throw error;
  }
}

/**
 * Check if URL needs R2 transfer
 * Returns true if URL is a private R2 endpoint
 */
export function isPrivateR2Url(url: string): boolean {
  // Private R2 URLs contain r2.cloudflarestorage.com (private endpoint)
  // Public R2 URLs would be pub-xxx.r2.dev or custom domain
  if (url.includes('.r2.cloudflarestorage.com')) {
    return true; // This is the private S3-compatible endpoint
  }
  // Check for public R2 URLs that don't need transfer
  if (url.includes('pub-') && url.includes('.r2.dev')) {
    return false; // This is a public R2 URL
  }
  return false; // Not an R2 URL at all
}