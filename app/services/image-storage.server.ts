import { uploadImageFromUrlToR2 } from './storage.server';

/**
 * Download image from URL and upload to permanent R2 storage
 * Returns permanent URL that won't expire
 */
export async function storeImagePermanently(
  imageUrl: string,
  filename: string
): Promise<string> {
  try {
    console.log(`[ImageStorage] Storing image permanently:`, imageUrl);

    // Use existing R2 upload with ab-tests prefix
    const permanentUrl = await uploadImageFromUrlToR2(imageUrl, {
      keyPrefix: 'ab-tests/base-images/',
      productId: filename, // Use filename as subfolder
    });

    console.log(`[ImageStorage] ✓ Stored at:`, permanentUrl);
    return permanentUrl;
  } catch (error) {
    console.error('[ImageStorage] Failed to store image:', error);
    throw new Error(`Image storage failed: ${(error as Error).message}`);
  }
}

/**
 * Store multiple images in parallel
 * Returns array of permanent URLs in same order as input
 */
export async function storeImagesBatch(
  images: Array<{ url: string; filename: string }>
): Promise<string[]> {
  const uploadPromises = images.map((img, index) =>
    storeImagePermanently(img.url, `${img.filename}-${index}`)
  );

  try {
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('[ImageStorage] Batch upload failed:', error);
    throw error;
  }
}

/**
 * Derive public R2 domain from private endpoint (same logic as storage.server.ts)
 */
function getPublicR2Domain(): string {
  if (process.env.R2_PUBLIC_DOMAIN) {
    return process.env.R2_PUBLIC_DOMAIN;
  }
  const endpoint = process.env.S3_ENDPOINT || '';
  const match = endpoint.match(/https?:\/\/([^.]+)\.r2\.cloudflarestorage\.com/);
  if (match && match[1]) {
    return `https://pub-${match[1]}.r2.dev`;
  }
  return endpoint;
}

/**
 * Check if URL is a permanent storage URL (not Shopify CDN)
 */
export function isPermanentUrl(url: string): boolean {
  const endpoint = process.env.S3_ENDPOINT || '';
  const publicDomain = getPublicR2Domain();

  // Check for private R2 endpoint
  if (url.includes(endpoint) || url.includes('r2.cloudflarestorage.com')) {
    return true;
  }

  // Check for public R2 domain (pub-xxx.r2.dev or custom domain)
  if (publicDomain) {
    const domainPattern = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (url.includes(domainPattern)) {
      return true;
    }
  }

  // Check for standard public R2 pattern
  if (url.includes('pub-') && url.includes('.r2.dev')) {
    return true;
  }

  return false;
}

/**
 * Get a safe URL for image creation
 * Returns permanent URL if available, otherwise original URL
 */
export function getSafeImageUrl(image: { url: string; permanentUrl?: string }): string {
  const useUrl = image.permanentUrl || image.url;
  console.log(`[getSafeImageUrl] Using ${image.permanentUrl ? 'PERMANENT' : 'ORIGINAL'} URL:`, useUrl.substring(0, 80));
  return useUrl;
}
