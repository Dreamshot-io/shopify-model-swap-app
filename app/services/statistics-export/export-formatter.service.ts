/**
 * Export formatter service for statistics exports
 * Handles formatting of statistics data into CSV and JSON formats
 */

import type { VariantStatistics } from '~/features/statistics-export/types';
import { CSV_HEADERS } from '~/features/statistics-export/constants';

/**
 * Escape CSV field if it contains special characters
 */
function escapeCSVField(field: string | number): string {
	const stringField = String(field);

	// If field contains comma, quote, or newline, wrap in quotes and escape quotes
	if (
		stringField.includes(',') ||
		stringField.includes('"') ||
		stringField.includes('\n')
	) {
		return `"${stringField.replace(/"/g, '""')}"`;
	}

	return stringField;
}

/**
 * Format a single variant statistics record as a CSV row
 */
export function formatCSVRow(stats: VariantStatistics): string {
	const {
		date,
		shopId,
		productId,
		variantId,
		shopifyProductId,
		shopifyVariantId,
		metrics,
		images,
	} = stats;

	// Extract and join image data
	const imageMediaIds = images.map((img) => img.mediaId).join('|');
	const shopifyImageUrls = images.map((img) => img.shopifyUrl).join('|');
	const r2ImageUrls = images.map((img) => img.r2Url || '').join('|');
	const r2ImageKeys = images.map((img) => img.r2Key || '').join('|');

	const row = [
		escapeCSVField(date),
		escapeCSVField(shopId),
		escapeCSVField(productId),
		escapeCSVField(variantId),
		escapeCSVField(shopifyProductId),
		escapeCSVField(shopifyVariantId),
		escapeCSVField(metrics.impressions),
		escapeCSVField(metrics.addToCarts),
		escapeCSVField(metrics.ctr.toFixed(4)),
		escapeCSVField(metrics.orders),
		escapeCSVField(metrics.revenue.toString()),
		escapeCSVField(imageMediaIds),
		escapeCSVField(shopifyImageUrls),
		escapeCSVField(r2ImageUrls),
		escapeCSVField(r2ImageKeys),
	];

	return row.join(',');
}

/**
 * Format variant statistics array to CSV string
 */
export function formatStatisticsToCSV(
	statistics: VariantStatistics[],
): string {
	const header = CSV_HEADERS.join(',');
	const rows = statistics.map((stat) => formatCSVRow(stat));

	return [header, ...rows].join('\n');
}

/**
 * Format variant statistics to JSON structure
 * One variant per file
 */
export function formatStatisticsToJSON(
	stats: VariantStatistics,
	shopDomain: string,
): object {
	return {
		exportDate: stats.date,
		shopId: stats.shopId,
		shopDomain,
		product: {
			productId: stats.productId,
			shopifyProductId: stats.shopifyProductId,
		},
		variant: {
			variantId: stats.variantId,
			shopifyVariantId: stats.shopifyVariantId,
			metrics: {
				impressions: stats.metrics.impressions,
				addToCarts: stats.metrics.addToCarts,
				ctr: stats.metrics.ctr,
				orders: stats.metrics.orders,
				revenue: stats.metrics.revenue,
			},
			images: stats.images.map((img) => ({
				mediaId: img.mediaId,
				shopifyUrl: img.shopifyUrl,
				r2Url: img.r2Url,
				r2Key: img.r2Key,
				backedUpAt: img.backedUpAt?.toISOString() || null,
			})),
		},
	};
}
