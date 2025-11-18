/**
 * Tests for export storage service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment variables FIRST
vi.stubEnv('S3_ENDPOINT', 'https://test.r2.cloudflarestorage.com');
vi.stubEnv('S3_ACCESS_KEY', 'test-access-key');
vi.stubEnv('S3_SECRET_KEY', 'test-secret-key');
vi.stubEnv('S3_REGION', 'auto');
vi.stubEnv('S3_BUCKET', 'test-bucket');

// Mock S3 client
const mockS3Send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: vi.fn().mockImplementation(() => ({
		send: mockS3Send,
	})),
	PutObjectCommand: vi.fn().mockImplementation((params) => params),
}));

// Import service AFTER mocks
const { generateStatisticsR2Key, uploadStatisticsExport } = await import(
	'./export-storage.service'
);

describe('export-storage.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('generateStatisticsR2Key', () => {
		it('should generate correct R2 key for CSV', () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const format = 'csv';

			// Act
			const key = generateStatisticsR2Key(shopId, productId, variantId, date, format);

			// Assert
			expect(key).toBe('statistic-exports/shop123/prod456/var789/20251118.csv');
		});

		it('should generate correct R2 key for JSON', () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const format = 'json';

			// Act
			const key = generateStatisticsR2Key(shopId, productId, variantId, date, format);

			// Assert
			expect(key).toBe('statistic-exports/shop123/prod456/var789/20251118.json');
		});

		it('should format date correctly (YYYYMMDD)', () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-01-05T00:00:00Z'); // Single digit month/day
			const format = 'csv';

			// Act
			const key = generateStatisticsR2Key(shopId, productId, variantId, date, format);

			// Assert
			expect(key).toContain('20250105'); // Should be padded
		});

		it('should handle different dates', () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const format = 'csv';

			// Act
			const key1 = generateStatisticsR2Key(shopId, productId, variantId, new Date('2025-11-18'), format);
			const key2 = generateStatisticsR2Key(shopId, productId, variantId, new Date('2025-12-25'), format);

			// Assert
			expect(key1).toContain('20251118');
			expect(key2).toContain('20251225');
		});
	});

	describe('uploadStatisticsExport', () => {
		it('should upload CSV content to R2', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = 'date,shopId,productId\n2025-11-18,shop123,prod456';
			const format = 'csv';

			mockS3Send.mockResolvedValue({ ETag: 'test-etag' });

			// Act
			const result = await uploadStatisticsExport(
				shopId,
				productId,
				variantId,
				date,
				content,
				format,
			);

			// Assert
			expect(result.success).toBe(true);
			expect(result.r2Key).toBe('statistic-exports/shop123/prod456/var789/20251118.csv');
			expect(result.r2Url).toContain('https://test.r2.cloudflarestorage.com');
			expect(mockS3Send).toHaveBeenCalledWith(
				expect.objectContaining({
					Bucket: 'test-bucket',
					Key: 'statistic-exports/shop123/prod456/var789/20251118.csv',
					ContentType: 'text/csv',
				}),
			);
		});

		it('should upload JSON content to R2', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = JSON.stringify({ exportDate: '2025-11-18' });
			const format = 'json';

			mockS3Send.mockResolvedValue({ ETag: 'test-etag' });

			// Act
			const result = await uploadStatisticsExport(
				shopId,
				productId,
				variantId,
				date,
				content,
				format,
			);

			// Assert
			expect(result.success).toBe(true);
			expect(result.r2Key).toContain('.json');
			expect(mockS3Send).toHaveBeenCalledWith(
				expect.objectContaining({
					ContentType: 'application/json',
				}),
			);
		});

		it('should return error on upload failure', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = 'test content';
			const format = 'csv';

			const uploadError = new Error('S3 upload failed');
			mockS3Send.mockRejectedValue(uploadError);

			// Act
			const result = await uploadStatisticsExport(
				shopId,
				productId,
				variantId,
				date,
				content,
				format,
			);

			// Assert
			expect(result.success).toBe(false);
			expect(result.error).toContain('S3 upload failed');
		});

		it('should use correct content type for CSV', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = 'csv content';
			const format = 'csv';

			mockS3Send.mockResolvedValue({ ETag: 'test-etag' });

			// Act
			await uploadStatisticsExport(shopId, productId, variantId, date, content, format);

			// Assert
			expect(mockS3Send).toHaveBeenCalledWith(
				expect.objectContaining({
					ContentType: 'text/csv',
				}),
			);
		});

		it('should use correct content type for JSON', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = '{"test": "json"}';
			const format = 'json';

			mockS3Send.mockResolvedValue({ ETag: 'test-etag' });

			// Act
			await uploadStatisticsExport(shopId, productId, variantId, date, content, format);

			// Assert
			expect(mockS3Send).toHaveBeenCalledWith(
				expect.objectContaining({
					ContentType: 'application/json',
				}),
			);
		});

		it('should generate private R2 URL', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');
			const content = 'test content';
			const format = 'csv';

			mockS3Send.mockResolvedValue({ ETag: 'test-etag' });

			// Act
			const result = await uploadStatisticsExport(
				shopId,
				productId,
				variantId,
				date,
				content,
				format,
			);

			// Assert
			expect(result.r2Url).toBe(
				'https://test.r2.cloudflarestorage.com/test-bucket/statistic-exports/shop123/prod456/var789/20251118.csv',
			);
		});
	});
});
