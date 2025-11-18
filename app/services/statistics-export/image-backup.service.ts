/**
 * Image backup service for statistics exports
 * Handles backing up Shopify product images to R2 storage
 */

import { prisma } from '~/db.server';
import { uploadImageFromUrlToR2 } from '~/services/storage.server';
import type {
	ImageBackupParams,
	ImageBackupResult,
} from '~/features/statistics-export/types';

/**
 * Generate R2 key for product image backup
 * Format: product-images/{shopId}/{productId}/{variantId}/{mediaId}.{ext}
 */
export function generateR2Key(
	shopId: string,
	productId: string,
	variantId: string,
	mediaId: string,
	extension: string,
): string {
	return `product-images/${shopId}/${productId}/${variantId}/${mediaId}.${extension}`;
}

/**
 * Extract file extension from URL or content type
 */
function extractExtension(url: string): string {
	const urlParts = url.split('.');
	const lastPart = urlParts[urlParts.length - 1]?.toLowerCase();

	if (lastPart && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(lastPart)) {
		return lastPart;
	}

	// Default to jpg if unable to determine
	return 'jpg';
}

/**
 * Check if an image is already backed up to R2
 */
export async function isImageBackedUp(
	shopId: string,
	mediaId: string,
): Promise<boolean> {
	const backup = await prisma.productImageBackup.findUnique({
		where: {
			shop_mediaId: {
				shop: shopId,
				mediaId,
			},
		},
	});

	return backup !== null && backup.r2Url !== null;
}

/**
 * Backup a single image to R2
 * Idempotent - returns existing backup if already exists
 */
export async function backupImageToR2(
	params: ImageBackupParams,
): Promise<ImageBackupResult> {
	const { shopId, productId, variantId, mediaId, shopifyUrl } = params;

	try {
		// Check if already backed up
		const existingBackup = await prisma.productImageBackup.findUnique({
			where: {
				shop_mediaId: {
					shop: shopId,
					mediaId,
				},
			},
		});

		if (existingBackup && existingBackup.r2Url) {
			return {
				success: true,
				mediaId,
				r2Key: existingBackup.r2Key,
				r2Url: existingBackup.r2Url,
			};
		}

		// Extract extension and generate R2 key
		const extension = extractExtension(shopifyUrl);
		const r2Key = generateR2Key(shopId, productId, variantId, mediaId, extension);

		// Upload to R2
		const keyPrefix = `product-images/${shopId}/${productId}/${variantId}/`;
		const r2Url = await uploadImageFromUrlToR2(shopifyUrl, {
			keyPrefix,
			productId,
		});

		// Create or update backup record
		await prisma.productImageBackup.create({
			data: {
				shop: shopId,
				productId,
				variantId,
				mediaId,
				shopifyUrl,
				r2Url,
				r2Key,
				backedUpAt: new Date(),
			},
		});

		return {
			success: true,
			mediaId,
			r2Key,
			r2Url,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			success: false,
			mediaId,
			r2Key: null,
			r2Url: null,
			error: errorMessage,
		};
	}
}

/**
 * Backup multiple images for a product variant
 * Processes all images in parallel
 */
export async function backupProductVariantImages(
	shopId: string,
	productId: string,
	variantId: string,
	images: Array<{ mediaId: string; shopifyUrl: string }>,
): Promise<ImageBackupResult[]> {
	if (images.length === 0) {
		return [];
	}

	const backupPromises = images.map((image) =>
		backupImageToR2({
			shopId,
			productId,
			variantId,
			mediaId: image.mediaId,
			shopifyUrl: image.shopifyUrl,
		}),
	);

	return Promise.all(backupPromises);
}
