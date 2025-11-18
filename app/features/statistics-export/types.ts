/**
 * Types for statistics export feature
 */

import type { Decimal } from '@prisma/client/runtime/library';

/**
 * Metrics for a specific product variant on a specific date
 */
export interface VariantMetrics {
	impressions: number;
	addToCarts: number;
	ctr: number; // Click-through rate (addToCarts / impressions)
	orders: number;
	revenue: Decimal | number;
}

/**
 * Image reference with backup information
 */
export interface ImageReference {
	mediaId: string; // Shopify media ID
	shopifyUrl: string; // Shopify CDN URL
	r2Url: string | null; // R2 permanent URL (null if not backed up)
	r2Key: string | null; // R2 object key
	backedUpAt: Date | null; // When backed up to R2
}

/**
 * Complete statistics for a product variant on a specific date
 */
export interface VariantStatistics {
	shopId: string;
	productId: string;
	variantId: string;
	shopifyProductId: string; // GID format
	shopifyVariantId: string; // GID format
	date: string; // YYYY-MM-DD format (UTC)
	metrics: VariantMetrics;
	images: ImageReference[];
}

/**
 * Product-level statistics (aggregates all variants)
 */
export interface ProductStatistics {
	shopId: string;
	productId: string;
	shopifyProductId: string;
	date: string; // YYYY-MM-DD format (UTC)
	variants: VariantStatistics[];
}

/**
 * Complete export data structure
 */
export interface StatisticsExportData {
	exportDate: string; // YYYY-MM-DD format (UTC)
	shopId: string;
	shopDomain: string;
	products: ProductStatistics[];
}

/**
 * R2 backup parameters for a single image
 */
export interface ImageBackupParams {
	shopId: string;
	productId: string;
	variantId: string;
	mediaId: string;
	shopifyUrl: string;
}

/**
 * Result of an image backup operation
 */
export interface ImageBackupResult {
	success: boolean;
	mediaId: string;
	r2Key: string | null;
	r2Url: string | null;
	error?: string;
}

/**
 * Parameters for generating statistics export
 */
export interface ExportGenerationParams {
	shopId: string;
	productId: string;
	variantId: string;
	date: Date; // UTC date
}

/**
 * Result of export generation
 */
export interface ExportGenerationResult {
	success: boolean;
	csvR2Key: string;
	jsonR2Key: string;
	csvUrl: string;
	jsonUrl: string;
	error?: string;
}

/**
 * CSV row structure for statistics export
 */
export interface StatisticsCSVRow {
	date: string;
	shopId: string;
	productId: string;
	variantId: string;
	shopifyProductId: string;
	shopifyVariantId: string;
	impressions: number;
	addToCarts: number;
	ctr: string; // Formatted as percentage
	orders: number;
	revenue: string; // Formatted as decimal
	imageMediaIds: string; // Comma-separated
	shopifyImageUrls: string; // Comma-separated
	r2ImageUrls: string; // Comma-separated
	r2ImageKeys: string; // Comma-separated
}
