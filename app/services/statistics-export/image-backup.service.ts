/**
 * Image backup service for statistics exports
 * Handles backing up Shopify product images to R2 storage
 */

import prisma from '~/db.server';
import { uploadImageFromUrlToR2 } from '~/services/storage.server';
import type {
	ImageBackupParams,
	ImageBackupResult,
} from '~/features/statistics-export/types';

/**
 * Generate R2 key for product image backup
 * Format: product-images/{shopId}/{productId}/{mediaId}.{ext}
 */
export function generateR2Key(
	shopId: string,
	productId: string,
	mediaId: string,
	extension: string,
): string {
	return `product-images/${shopId}/${productId}/${mediaId}.${extension}`;
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
	const backup = await prisma.productInfo.findUnique({
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
	const { shopId, productId, mediaId, shopifyUrl } = params;

	try {
		// Check if already backed up
		const existingBackup = await prisma.productInfo.findUnique({
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
		const r2Key = generateR2Key(shopId, productId, mediaId, extension);

		// Upload to R2
		const keyPrefix = `product-images/${shopId}/${productId}/`;
		const r2Url = await uploadImageFromUrlToR2(shopifyUrl, {
			keyPrefix,
			productId,
		});

		// Create or update backup record (upsert for idempotency)
		await prisma.productInfo.upsert({
			where: {
				shop_mediaId: {
					shop: shopId,
					mediaId,
				},
			},
			create: {
				shop: shopId,
				productId,
				mediaId,
				shopifyUrl,
				r2Url,
				r2Key,
				backedUpAt: new Date(),
			},
			update: {
				productId,
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
 * Backup multiple images for a product
 * Processes all images in parallel
 */
export async function backupProductImages(
	shopId: string,
	productId: string,
	images: Array<{ mediaId: string; shopifyUrl: string }>,
): Promise<ImageBackupResult[]> {
	if (images.length === 0) {
		return [];
	}

	const backupPromises = images.map((image) =>
		backupImageToR2({
			shopId,
			productId,
			mediaId: image.mediaId,
			shopifyUrl: image.shopifyUrl,
		}),
	);

	return Promise.all(backupPromises);
}

/**
 * @deprecated Use backupProductImages instead (variantId removed)
 */
export async function backupProductVariantImages(
	shopId: string,
	productId: string,
	_variantId: string,
	images: Array<{ mediaId: string; shopifyUrl: string }>,
): Promise<ImageBackupResult[]> {
	return backupProductImages(shopId, productId, images);
}
