/**
 * Tests for export formatter service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { VariantStatistics } from '~/features/statistics-export/types';

let formatStatisticsToCSV: (statistics: VariantStatistics[]) => string;
let formatStatisticsToJSON: (stats: VariantStatistics, shopDomain: string) => {
	exportDate: string;
	shopId: string;
	shopDomain: string;
	product: { productId: string; shopifyProductId: string };
	variant: {
		variantId: string;
		shopifyVariantId: string;
		metrics: { impressions: number; addToCarts: number; ctr: number; orders: number; revenue: number | string };
		images: Array<{ mediaId: string; shopifyUrl: string; r2Url: string | null; r2Key: string | null; backedUpAt: string | null }>;
	};
};
let formatCSVRow: (stats: VariantStatistics) => string;

// Load module before all tests
beforeAll(async () => {
	const module = await import('./export-formatter.service?t=' + Date.now());
	formatStatisticsToCSV = module.formatStatisticsToCSV;
	formatStatisticsToJSON = module.formatStatisticsToJSON;
	formatCSVRow = module.formatCSVRow;
});

describe('export-formatter.service', () => {
	describe('formatCSVRow', () => {
		it('should format variant statistics as CSV row', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 100,
					addToCarts: 15,
					ctr: 0.15,
					orders: 3,
					revenue: 89.97,
				},
				images: [
					{
						mediaId: 'gid://shopify/MediaImage/1',
						shopifyUrl: 'https://cdn.shopify.com/image1.jpg',
						r2Url: 'https://r2.example.com/image1.jpg',
						r2Key: 'product-images/shop123/prod456/var789/1.jpg',
						backedUpAt: new Date('2025-11-18T10:00:00Z'),
					},
					{
						mediaId: 'gid://shopify/MediaImage/2',
						shopifyUrl: 'https://cdn.shopify.com/image2.jpg',
						r2Url: null,
						r2Key: null,
						backedUpAt: null,
					},
				],
			};

			// Act
			const row = formatCSVRow(stats);

			// Assert
			expect(row).toContain('2025-11-18');
			expect(row).toContain('shop123');
			expect(row).toContain('prod456');
			expect(row).toContain('var789');
			expect(row).toContain('gid://shopify/Product/123');
			expect(row).toContain('100'); // impressions
			expect(row).toContain('15'); // addToCarts
			expect(row).toContain('0.15'); // CTR
			expect(row).toContain('3'); // orders
			expect(row).toContain('89.97'); // revenue
		});

		it('should handle empty images array', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 0,
					addToCarts: 0,
					ctr: 0,
					orders: 0,
					revenue: 0,
				},
				images: [],
			};

			// Act
			const row = formatCSVRow(stats);

			// Assert
			expect(row).toContain(',,,'); // Empty image fields
		});

		it('should escape commas in fields', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop,with,commas',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 0,
					addToCarts: 0,
					ctr: 0,
					orders: 0,
					revenue: 0,
				},
				images: [],
			};

			// Act
			const row = formatCSVRow(stats);

			// Assert
			expect(row).toContain('"shop,with,commas"');
		});
	});

	describe('formatStatisticsToCSV', () => {
		it('should format multiple variant statistics to CSV', () => {
			// Arrange
			const stats: VariantStatistics[] = [
				{
					shopId: 'shop123',
					productId: 'prod456',
					variantId: 'var789',
					shopifyProductId: 'gid://shopify/Product/123',
					shopifyVariantId: 'gid://shopify/ProductVariant/456',
					date: '2025-11-18',
					metrics: {
						impressions: 100,
						addToCarts: 15,
						ctr: 0.15,
						orders: 3,
						revenue: 89.97,
					},
					images: [],
				},
				{
					shopId: 'shop123',
					productId: 'prod456',
					variantId: 'var999',
					shopifyProductId: 'gid://shopify/Product/123',
					shopifyVariantId: 'gid://shopify/ProductVariant/999',
					date: '2025-11-18',
					metrics: {
						impressions: 50,
						addToCarts: 5,
						ctr: 0.1,
						orders: 1,
						revenue: 29.99,
					},
					images: [],
				},
			];

			// Act
			const csv = formatStatisticsToCSV(stats);

			// Assert
			const lines = csv.split('\n');
			expect(lines[0]).toContain('date');
			expect(lines[0]).toContain('shopId');
			expect(lines[0]).toContain('impressions');
			expect(lines).toHaveLength(3); // Header + 2 data rows
		});

		it('should return only header for empty array', () => {
			// Arrange
			const stats: VariantStatistics[] = [];

			// Act
			const csv = formatStatisticsToCSV(stats);

			// Assert
			const lines = csv.split('\n').filter((l) => l.length > 0);
			expect(lines).toHaveLength(1); // Only header
			expect(lines[0]).toContain('date');
		});
	});

	describe('formatStatisticsToJSON', () => {
		it('should format statistics to JSON structure', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 100,
					addToCarts: 15,
					ctr: 0.15,
					orders: 3,
					revenue: 89.97,
				},
				images: [
					{
						mediaId: 'gid://shopify/MediaImage/1',
						shopifyUrl: 'https://cdn.shopify.com/image1.jpg',
						r2Url: 'https://r2.example.com/image1.jpg',
						r2Key: 'product-images/shop123/prod456/var789/1.jpg',
						backedUpAt: new Date('2025-11-18T10:00:00Z'),
					},
				],
			};
			const shopDomain = 'myshop.myshopify.com';

			// Act
			const json = formatStatisticsToJSON(stats, shopDomain);

			// Assert
			expect(json).toHaveProperty('exportDate', '2025-11-18');
			expect(json).toHaveProperty('shopId', 'shop123');
			expect(json).toHaveProperty('shopDomain', 'myshop.myshopify.com');
			expect(json.variant).toHaveProperty('variantId', 'var789');
			expect(json.variant.metrics).toHaveProperty('impressions', 100);
			expect(json.variant.images).toHaveLength(1);
		});

		it('should handle variant with no images', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 0,
					addToCarts: 0,
					ctr: 0,
					orders: 0,
					revenue: 0,
				},
				images: [],
			};
			const shopDomain = 'myshop.myshopify.com';

			// Act
			const json = formatStatisticsToJSON(stats, shopDomain);

			// Assert
			expect(json.variant.images).toEqual([]);
		});

		it('should serialize to valid JSON string', () => {
			// Arrange
			const stats: VariantStatistics = {
				shopId: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				shopifyProductId: 'gid://shopify/Product/123',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: '2025-11-18',
				metrics: {
					impressions: 100,
					addToCarts: 15,
					ctr: 0.15,
					orders: 3,
					revenue: 89.97,
				},
				images: [],
			};
			const shopDomain = 'myshop.myshopify.com';

			// Act
			const json = formatStatisticsToJSON(stats, shopDomain);
			const jsonString = JSON.stringify(json);

			// Assert
			expect(() => JSON.parse(jsonString)).not.toThrow();
			const parsed = JSON.parse(jsonString);
			expect(parsed.exportDate).toBe('2025-11-18');
		});
	});
});
