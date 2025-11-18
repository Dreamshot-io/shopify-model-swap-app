/**
 * Constants for statistics export feature
 */

/**
 * R2 key prefixes for different storage types
 */
export const R2_KEY_PREFIXES = {
	STATISTICS_EXPORTS: 'statistic-exports',
	PRODUCT_IMAGES: 'product-images',
} as const;

/**
 * Export file formats
 */
export const EXPORT_FORMATS = {
	CSV: 'csv',
	JSON: 'json',
} as const;

/**
 * CSV headers for statistics export
 */
export const CSV_HEADERS = [
	'date',
	'shopId',
	'productId',
	'variantId',
	'shopifyProductId',
	'shopifyVariantId',
	'impressions',
	'addToCarts',
	'ctr',
	'orders',
	'revenue',
	'imageMediaIds',
	'shopifyImageUrls',
	'r2ImageUrls',
	'r2ImageKeys',
] as const;

/**
 * Supported image file extensions
 */
export const SUPPORTED_IMAGE_EXTENSIONS = [
	'jpg',
	'jpeg',
	'png',
	'webp',
	'gif',
] as const;

/**
 * Date format for exports (YYYYMMDD)
 */
export const EXPORT_DATE_FORMAT = 'yyyyMMdd';

/**
 * Date format for display (YYYY-MM-DD)
 */
export const DISPLAY_DATE_FORMAT = 'yyyy-MM-dd';
