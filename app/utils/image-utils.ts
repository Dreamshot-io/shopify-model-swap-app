/**
 * Image utilities for A/B testing
 * Handles deduplication, URL normalization, and media comparison
 */

export interface ImageData {
  url: string;
  mediaId?: string;
  permanentUrl?: string;
  position: number;
  altText?: string;
}

/**
 * Normalize URL for comparison
 * Removes query parameters and converts to lowercase
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.toLowerCase();
  } catch (e) {
    // If URL parsing fails, just use original lowercased
    return url.split('?')[0].toLowerCase();
  }
}

/**
 * Deduplicate images based on normalized URLs
 * Prefers images with mediaIds when duplicates found
 */
export function deduplicateImages(images: ImageData[]): ImageData[] {
  const seen = new Map<string, ImageData>();

  for (const img of images) {
    const normalizedUrl = normalizeUrl(img.url);

    if (!seen.has(normalizedUrl)) {
      seen.set(normalizedUrl, img);
    } else {
      // Keep the one with mediaId if available
      const existing = seen.get(normalizedUrl)!;
      if (img.mediaId && !existing.mediaId) {
        seen.set(normalizedUrl, img);
      }
      // If both have mediaIds or neither do, keep first one
    }
  }

  return Array.from(seen.values());
}

/**
 * Compare two image sets and determine what operations are needed
 */
export function calculateMediaDiff(
  currentImages: ImageData[],
  targetImages: ImageData[]
): {
  toKeep: ImageData[];
  toAdd: ImageData[];
  toDelete: string[];
  needsReorder: boolean;
} {
  // Deduplicate both sets first
  const dedupedCurrent = deduplicateImages(currentImages);
  const dedupedTarget = deduplicateImages(targetImages);

  // Build maps for efficient lookup
  const currentMap = new Map(
    dedupedCurrent.map(img => [normalizeUrl(img.url), img])
  );
  const targetMap = new Map(
    dedupedTarget.map(img => [normalizeUrl(img.url), img])
  );

  const toKeep: ImageData[] = [];
  const toAdd: ImageData[] = [];
  const toDelete: string[] = [];

  // Find images to KEEP (in both current and target)
  for (const [url, targetImg] of targetMap) {
    if (currentMap.has(url)) {
      const currentImg = currentMap.get(url)!;
      // Reuse existing mediaId
      toKeep.push({
        ...targetImg,
        mediaId: currentImg.mediaId,
      });
    } else {
      // Need to create this image
      toAdd.push(targetImg);
    }
  }

  // Find images to DELETE (in current but not in target)
  for (const [url, currentImg] of currentMap) {
    if (!targetMap.has(url) && currentImg.mediaId) {
      toDelete.push(currentImg.mediaId);
    }
  }

  // Check if reordering needed
  const currentOrder = dedupedCurrent.map(img => normalizeUrl(img.url));
  const targetOrder = dedupedTarget.map(img => normalizeUrl(img.url));
  const needsReorder = currentOrder.join(',') !== targetOrder.join(',');

  return {
    toKeep,
    toAdd,
    toDelete,
    needsReorder,
  };
}

/**
 * Merge test images with preserved images
 */
export function mergeWithPreservedImages(
  testImages: ImageData[],
  preservedImages: ImageData[]
): ImageData[] {
  // Deduplicate across both sets
  const combined = [...testImages, ...preservedImages];
  return deduplicateImages(combined);
}