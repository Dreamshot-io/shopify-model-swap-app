/**
 * Statistics export orchestrator service
 * Coordinates all services to generate complete statistics exports
 */

import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import prisma from '~/db.server';
import type { VariantStatistics, ImageReference } from '~/features/statistics-export/types';
import { getVariantMetricsForDate } from './metrics-calculator.service';
import { backupProductVariantImages } from './image-backup.service';
import { getProductVariants, getProductImages } from './product-fetcher.service';
import { formatStatisticsToCSV, formatStatisticsToJSON } from './export-formatter.service';
import { uploadStatisticsExport } from './export-storage.service';
import { saveVariantStatistics } from './statistics-persistence.service';

/**
 * Parameters for generating a single variant statistics export
 */
export interface ExportVariantParams {
	admin: AdminApiContext['graphql'];
	shopId: string;
	shopDomain: string;
	productId: string;
	shopifyProductId: string;
	variantId: string;
	shopifyVariantId: string;
	date: Date;
}

/**
 * Result of a variant export operation
 */
export interface ExportVariantResult {
	success: boolean;
	variantId: string;
	csvR2Key?: string;
	jsonR2Key?: string;
	csvUrl?: string;
	jsonUrl?: string;
	error?: string;
}

/**
 * Get backed-up image references for a product
 * Returns image data with R2 backup status
 */
async function getImageReferences(
	admin: AdminApiContext['graphql'],
	shopId: string,
	productId: string,
	variantId: string,
	shopifyProductId: string,
): Promise<ImageReference[]> {
	// Fetch images from Shopify
	const shopifyImages = await getProductImages(admin, shopifyProductId);

	if (shopifyImages.length === 0) {
		return [];
	}

	// Backup images to R2
	const imagesToBackup = shopifyImages.map((img) => ({
		mediaId: img.mediaId,
		shopifyUrl: img.url,
	}));

	await backupProductVariantImages(shopId, productId, variantId, imagesToBackup);

	// Fetch backup records from database
	const backupRecords = await prisma.productImageBackup.findMany({
		where: {
			shop: shopId,
			productId,
			variantId,
		},
	});

	// Map to ImageReference format
	return shopifyImages.map((img) => {
		const backup = backupRecords.find((b) => b.mediaId === img.mediaId);
		return {
			mediaId: img.mediaId,
			shopifyUrl: img.url,
			r2Url: backup?.r2Url || null,
			r2Key: backup?.r2Key || null,
			backedUpAt: backup?.backedUpAt || null,
		};
	});
}

/**
 * Generate statistics export for a single product variant
 * Orchestrates: metrics calculation, image backup, formatting, upload, DB record
 */
export async function exportProductVariantStatistics(
	params: ExportVariantParams,
): Promise<ExportVariantResult> {
	const {
		admin,
		shopId,
		shopDomain,
		productId,
		shopifyProductId,
		variantId,
		shopifyVariantId,
		date,
	} = params;

	try {
		// 1. Calculate metrics for this variant
		const metrics = await getVariantMetricsForDate(shopId, productId, variantId, date);

		// 2. Get and backup product images
		const images = await getImageReferences(
			admin,
			shopId,
			productId,
			variantId,
			shopifyProductId,
		);

		// 3. Build variant statistics object
		const variantStats: VariantStatistics = {
			shopId,
			productId,
			variantId,
			shopifyProductId,
			shopifyVariantId,
			date: date.toISOString().split('T')[0], // YYYY-MM-DD
			metrics,
			images,
		};

		// 4. Format to CSV and JSON
		const csvContent = formatStatisticsToCSV([variantStats]);
		const jsonContent = JSON.stringify(formatStatisticsToJSON(variantStats, shopDomain), null, 2);

		// 5. Upload both formats to R2
		const [csvUpload, jsonUpload] = await Promise.all([
			uploadStatisticsExport(shopId, productId, variantId, date, csvContent, 'csv'),
			uploadStatisticsExport(shopId, productId, variantId, date, jsonContent, 'json'),
		]);

		if (!csvUpload.success || !jsonUpload.success) {
			throw new Error(
				`Upload failed: CSV=${csvUpload.error || 'ok'}, JSON=${jsonUpload.error || 'ok'}`,
			);
		}

		// 6. Save export record to database with statistics
		const exportRecord = await prisma.statisticsExport.create({
			data: {
				shop: shopId,
				productId,
				variantId,
				date,
				csvR2Key: csvUpload.r2Key,
				jsonR2Key: jsonUpload.r2Key,
				csvUrl: csvUpload.r2Url,
				jsonUrl: jsonUpload.r2Url,
				metricsSnapshot: metrics,
				imagesSnapshot: images,
			},
		});

		// 7. Get ProductImageBackup IDs for linking
		const mediaIds = images.map((img) => img.mediaId);
		const imageBackups = await prisma.productImageBackup.findMany({
			where: {
				shop: shopId,
				mediaId: { in: mediaIds },
			},
			select: { id: true },
		});
		const imageBackupIds = imageBackups.map((backup) => backup.id);

		// 8. Save queryable statistics to VariantDailyStatistics
		await saveVariantStatistics({
			exportId: exportRecord.id,
			shopId,
			productId,
			variantId,
			date,
			metrics,
			imageBackupIds,
		});

		return {
			success: true,
			variantId,
			csvR2Key: csvUpload.r2Key,
			jsonR2Key: jsonUpload.r2Key,
			csvUrl: csvUpload.r2Url,
			jsonUrl: jsonUpload.r2Url,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return {
			success: false,
			variantId,
			error: errorMessage,
		};
	}
}

/**
 * Generate statistics exports for all variants of a product
 */
export async function exportProductStatistics(
	admin: AdminApiContext['graphql'],
	shopId: string,
	shopDomain: string,
	productId: string,
	shopifyProductId: string,
	date: Date,
): Promise<ExportVariantResult[]> {
	// Fetch all variants for this product
	const variants = await getProductVariants(admin, shopifyProductId);

	// Export each variant in parallel
	const exportPromises = variants.map((variant) =>
		exportProductVariantStatistics({
			admin,
			shopId,
			shopDomain,
			productId,
			shopifyProductId,
			variantId: variant.id,
			shopifyVariantId: variant.id,
			date,
		}),
	);

	return Promise.all(exportPromises);
}
