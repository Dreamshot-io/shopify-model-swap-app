/**
 * Tests for statistics export orchestrator service
 * Integration-style tests for orchestration logic
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ExportVariantParams } from './statistics-export-orchestrator.service';

// Mock AWS SDK to prevent import errors
vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
	PutObjectCommand: vi.fn(),
	GetObjectCommand: vi.fn(),
}));

// Mock all dependencies
vi.mock('~/db.server', () => ({
	default: {
		productInfo: {
			findMany: vi.fn(),
		},
		statisticsExport: {
			create: vi.fn(),
		},
	},
}));

vi.mock('./metrics-calculator.service', () => ({
	getVariantMetricsForDate: vi.fn(),
}));

vi.mock('./image-backup.service', () => ({
	backupProductImages: vi.fn(),
}));

vi.mock('./product-fetcher.service', () => ({
	getProductVariants: vi.fn(),
	getProductImages: vi.fn(),
}));

vi.mock('./export-formatter.service', () => ({
	formatStatisticsToCSV: vi.fn(),
	formatStatisticsToJSON: vi.fn(),
}));

vi.mock('./export-storage.service', () => ({
	uploadStatisticsExport: vi.fn(),
}));

vi.mock('./statistics-persistence.service', () => ({
	saveVariantStatistics: vi.fn(),
}));

// Import after mocks
const { exportProductVariantStatistics, exportProductStatistics } = await import(
	'./statistics-export-orchestrator.service'
);
const prismaModule = await import('~/db.server');
const prisma = prismaModule.default;
const { getVariantMetricsForDate } = await import('./metrics-calculator.service');
const { backupProductImages } = await import('./image-backup.service');
const { getProductVariants, getProductImages } = await import('./product-fetcher.service');
const { formatStatisticsToCSV, formatStatisticsToJSON } = await import('./export-formatter.service');
const { uploadStatisticsExport } = await import('./export-storage.service');
const { saveVariantStatistics } = await import('./statistics-persistence.service');

describe('statistics-export-orchestrator.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('exportProductVariantStatistics', () => {
		it('should orchestrate complete export flow', async () => {
			// Arrange
			const params: ExportVariantParams = {
				admin: vi.fn() as never,
				shopId: 'shop123',
				shopDomain: 'test.myshopify.com',
				productId: 'prod456',
				shopifyProductId: 'gid://shopify/Product/123',
				variantId: 'var789',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: new Date('2025-11-18T00:00:00Z'),
			};

			// Mock metrics calculation
			(getVariantMetricsForDate as Mock).mockResolvedValue({
				impressions: 100,
				addToCarts: 15,
				ctr: 0.15,
				orders: 3,
				revenue: 89.97,
			});

			// Mock image fetching
			(getProductImages as Mock).mockResolvedValue([
				{
					mediaId: 'gid://shopify/MediaImage/1',
					url: 'https://cdn.shopify.com/image1.jpg',
					altText: 'Image 1',
				},
			]);

			// Mock image backup
			(backupProductImages as Mock).mockResolvedValue([
				{
					success: true,
					mediaId: 'gid://shopify/MediaImage/1',
					r2Key: 'product-images/shop123/prod456/1.jpg',
					r2Url: 'https://r2.example.com/image1.jpg',
				},
			]);

			// Mock backup records (productInfo)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			((prisma as any).productInfo.findMany as Mock).mockResolvedValue([
				{
					id: '1',
					shop: 'shop123',
					productId: 'prod456',
					mediaId: 'gid://shopify/MediaImage/1',
					shopifyUrl: 'https://cdn.shopify.com/image1.jpg',
					r2Url: 'https://r2.example.com/image1.jpg',
					r2Key: 'product-images/shop123/prod456/1.jpg',
					backedUpAt: new Date('2025-11-18T10:00:00Z'),
					tags: [],
					taggedAt: null,
					taggingError: null,
					strategicRationale: null,
					deletedAt: null,
					createdAt: new Date(),
					updatedAt: new Date(),
					shopId: null,
				},
			]);

			// Mock formatters
			(formatStatisticsToCSV as Mock).mockReturnValue('csv content');
			(formatStatisticsToJSON as Mock).mockReturnValue({ test: 'json' });

			// Mock uploads
			(uploadStatisticsExport as Mock).mockResolvedValue({
				success: true,
				r2Key: 'statistic-exports/shop123/prod456/var789/20251118.csv',
				r2Url: 'https://r2.example.com/export.csv',
			});

			// Mock database create
			(prisma.statisticsExport.create as Mock).mockResolvedValue({
				id: 'export123',
				shop: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-11-18'),
				csvR2Key: 'key.csv',
				jsonR2Key: 'key.json',
				csvUrl: 'url.csv',
				jsonUrl: 'url.json',
				metricsSnapshot: {},
				imagesSnapshot: {},
				exportedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
				shopId: null,
			});

			// Mock saveVariantStatistics
			(saveVariantStatistics as Mock).mockResolvedValue({
				id: 'stat123',
				exportId: 'export123',
				shop: 'shop123',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-11-18'),
				impressions: 100,
				addToCarts: 15,
				ctr: 0.15,
				orders: 3,
				revenue: 89.97,
				conversionRate: 0.03,
				createdAt: new Date(),
				updatedAt: new Date(),
				shopId: null,
			});

			// Act
			const result = await exportProductVariantStatistics(params);

			// Assert
			expect(result.success).toBe(true);
			expect(result.variantId).toBe('var789');
			expect(result.csvR2Key).toBeTruthy();
			expect(result.jsonR2Key).toBeTruthy();

			// Verify orchestration flow
			expect(getVariantMetricsForDate).toHaveBeenCalled();
			expect(getProductImages).toHaveBeenCalled();
			expect(backupProductImages).toHaveBeenCalled();
			expect(uploadStatisticsExport).toHaveBeenCalledTimes(2); // CSV + JSON
			expect(prisma.statisticsExport.create).toHaveBeenCalled();
			expect(saveVariantStatistics).toHaveBeenCalledWith(
				expect.objectContaining({
					exportId: 'export123',
					shopId: 'shop123',
					productId: 'prod456',
					variantId: 'var789',
					productInfoIds: ['1'],
				}),
			);
		});

		it('should return error if upload fails', async () => {
			// Arrange
			const params: ExportVariantParams = {
				admin: vi.fn() as never,
				shopId: 'shop123',
				shopDomain: 'test.myshopify.com',
				productId: 'prod456',
				shopifyProductId: 'gid://shopify/Product/123',
				variantId: 'var789',
				shopifyVariantId: 'gid://shopify/ProductVariant/456',
				date: new Date('2025-11-18T00:00:00Z'),
			};

			(getVariantMetricsForDate as Mock).mockResolvedValue({
				impressions: 0,
				addToCarts: 0,
				ctr: 0,
				orders: 0,
				revenue: 0,
			});

			(getProductImages as Mock).mockResolvedValue([]);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			((prisma as any).productInfo.findMany as Mock).mockResolvedValue([]);
			(formatStatisticsToCSV as Mock).mockReturnValue('csv');
			(formatStatisticsToJSON as Mock).mockReturnValue({});

			// CSV upload fails
			(uploadStatisticsExport as Mock).mockResolvedValueOnce({
				success: false,
				r2Key: '',
				r2Url: '',
				error: 'Upload failed',
			});

			// Act
			const result = await exportProductVariantStatistics(params);

			// Assert
			expect(result.success).toBe(false);
			expect(result.error).toContain('Upload failed');
		});
	});

	describe('exportProductStatistics', () => {
		it('should export all variants of a product', async () => {
			// Arrange
			const admin = vi.fn() as never;
			const shopId = 'shop123';
			const shopDomain = 'test.myshopify.com';
			const productId = 'prod456';
			const shopifyProductId = 'gid://shopify/Product/123';
			const date = new Date('2025-11-18T00:00:00Z');

			// Mock variants
			(getProductVariants as Mock).mockResolvedValue([
				{
					id: 'gid://shopify/ProductVariant/1',
					title: 'Small',
					displayName: 'Product - Small',
				},
				{
					id: 'gid://shopify/ProductVariant/2',
					title: 'Large',
					displayName: 'Product - Large',
				},
			]);

			// Mock successful export for each variant
			(getVariantMetricsForDate as Mock).mockResolvedValue({
				impressions: 0,
				addToCarts: 0,
				ctr: 0,
				orders: 0,
				revenue: 0,
			});
			(getProductImages as Mock).mockResolvedValue([]);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			((prisma as any).productInfo.findMany as Mock).mockResolvedValue([]);
			(formatStatisticsToCSV as Mock).mockReturnValue('csv');
			(formatStatisticsToJSON as Mock).mockReturnValue({});
			(uploadStatisticsExport as Mock).mockResolvedValue({
				success: true,
				r2Key: 'key',
				r2Url: 'url',
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			((prisma as any).statisticsExport.create as Mock).mockResolvedValue({
				id: 'export123',
			});
			(saveVariantStatistics as Mock).mockResolvedValue({});

			// Act
			const results = await exportProductStatistics(
				admin,
				shopId,
				shopDomain,
				productId,
				shopifyProductId,
				date,
			);

			// Assert
			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);
		});
	});
});
