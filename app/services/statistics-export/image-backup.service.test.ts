/**
 * Tests for image backup service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	generateR2Key,
	backupImageToR2,
	isImageBackedUp,
	backupProductImages,
	backupProductVariantImages,
} from './image-backup.service';
import type { ImageBackupParams } from '~/features/statistics-export/types';

// Mock Prisma client
const mockPrismaUpsert = vi.fn();
const mockPrismaFindUnique = vi.fn();
const mockPrismaFindMany = vi.fn();

vi.mock('~/db.server', () => ({
	default: {
		productInfo: {
			upsert: (...args: unknown[]) => mockPrismaUpsert(...args),
			findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
			findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
		},
	},
}));

// Mock storage service
const mockUploadImageFromUrlToR2 = vi.fn();
vi.mock('~/services/storage.server', () => ({
	uploadImageFromUrlToR2: (...args: unknown[]) =>
		mockUploadImageFromUrlToR2(...args),
}));

describe('image-backup.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('generateR2Key', () => {
		it('should generate correct R2 key format without variantId', () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const mediaId = 'media001';
			const extension = 'jpg';

			// Act
			const key = generateR2Key(shopId, productId, mediaId, extension);

			// Assert
			expect(key).toBe('product-images/shop123/prod456/media001.jpg');
		});

		it('should handle different extensions', () => {
			// Arrange
			const shopId = 'shop1';
			const productId = 'prod1';
			const mediaId = 'media1';

			// Act
			const pngKey = generateR2Key(shopId, productId, mediaId, 'png');
			const webpKey = generateR2Key(shopId, productId, mediaId, 'webp');

			// Assert
			expect(pngKey).toContain('.png');
			expect(webpKey).toContain('.webp');
		});

		it('should create hierarchical structure', () => {
			// Arrange
			const shopId = 'myshop';
			const productId = 'product1';
			const mediaId = 'media1';
			const extension = 'jpg';

			// Act
			const key = generateR2Key(shopId, productId, mediaId, extension);

			// Assert
			expect(key.startsWith('product-images/')).toBe(true);
			expect(key).toContain('/myshop/');
			expect(key).toContain('/product1/');
		});
	});

	describe('isImageBackedUp', () => {
		it('should return true if image is backed up', async () => {
			// Arrange
			const shopId = 'shop123';
			const mediaId = 'media456';
			mockPrismaFindUnique.mockResolvedValue({
				id: '1',
				shop: shopId,
				mediaId,
				r2Url: 'https://r2.example.com/image.jpg',
				backedUpAt: new Date(),
			});

			// Act
			const result = await isImageBackedUp(shopId, mediaId);

			// Assert
			expect(result).toBe(true);
			expect(mockPrismaFindUnique).toHaveBeenCalledWith({
				where: {
					shop_mediaId: {
						shop: shopId,
						mediaId,
					},
				},
			});
		});

		it('should return false if image not backed up', async () => {
			// Arrange
			const shopId = 'shop123';
			const mediaId = 'media456';
			mockPrismaFindUnique.mockResolvedValue(null);

			// Act
			const result = await isImageBackedUp(shopId, mediaId);

			// Assert
			expect(result).toBe(false);
		});

		it('should return false if backup record exists but no r2Url', async () => {
			// Arrange
			const shopId = 'shop123';
			const mediaId = 'media456';
			mockPrismaFindUnique.mockResolvedValue({
				id: '1',
				shop: shopId,
				mediaId,
				r2Url: null,
				backedUpAt: null,
			});

			// Act
			const result = await isImageBackedUp(shopId, mediaId);

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('backupImageToR2', () => {
		it('should skip backup if already backed up', async () => {
			// Arrange
			const params: ImageBackupParams = {
				shopId: 'shop123',
				productId: 'prod456',
				mediaId: 'media001',
				shopifyUrl: 'https://cdn.shopify.com/image.jpg',
			};
			mockPrismaFindUnique.mockResolvedValue({
				id: '1',
				shop: params.shopId,
				mediaId: params.mediaId,
				r2Url: 'https://r2.example.com/existing.jpg',
				r2Key: 'product-images/shop123/prod456/media001.jpg',
				backedUpAt: new Date(),
			});

			// Act
			const result = await backupImageToR2(params);

			// Assert
			expect(result.success).toBe(true);
			expect(mockUploadImageFromUrlToR2).not.toHaveBeenCalled();
			expect(result.r2Url).toBe('https://r2.example.com/existing.jpg');
		});

		it('should backup image if not already backed up', async () => {
			// Arrange
			const params: ImageBackupParams = {
				shopId: 'shop123',
				productId: 'prod456',
				mediaId: 'media001',
				shopifyUrl: 'https://cdn.shopify.com/image.jpg',
			};
			const expectedR2Url = 'https://r2.example.com/uploaded.jpg';

			mockPrismaFindUnique.mockResolvedValue(null);
			mockUploadImageFromUrlToR2.mockResolvedValue(expectedR2Url);
			mockPrismaUpsert.mockResolvedValue({
				id: '1',
				shop: params.shopId,
				productId: params.productId,
				mediaId: params.mediaId,
				shopifyUrl: params.shopifyUrl,
				r2Url: expectedR2Url,
				r2Key: 'product-images/shop123/prod456/media001.jpg',
				backedUpAt: new Date(),
			});

			// Act
			const result = await backupImageToR2(params);

			// Assert
			expect(result.success).toBe(true);
			expect(result.r2Url).toBe(expectedR2Url);
			expect(mockUploadImageFromUrlToR2).toHaveBeenCalledWith(
				params.shopifyUrl,
				expect.objectContaining({
					keyPrefix: expect.stringContaining('product-images/shop123/prod456'),
				}),
			);
			expect(mockPrismaUpsert).toHaveBeenCalled();
		});

		it('should return error if upload fails', async () => {
			// Arrange
			const params: ImageBackupParams = {
				shopId: 'shop123',
				productId: 'prod456',
				mediaId: 'media001',
				shopifyUrl: 'https://cdn.shopify.com/image.jpg',
			};
			const uploadError = new Error('Upload failed');

			mockPrismaFindUnique.mockResolvedValue(null);
			mockUploadImageFromUrlToR2.mockRejectedValue(uploadError);

			// Act
			const result = await backupImageToR2(params);

			// Assert
			expect(result.success).toBe(false);
			expect(result.error).toContain('Upload failed');
			expect(result.r2Url).toBeNull();
		});
	});

	describe('backupProductImages', () => {
		it('should backup multiple images in batch', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const images = [
				{ mediaId: 'media1', shopifyUrl: 'https://cdn.shopify.com/1.jpg' },
				{ mediaId: 'media2', shopifyUrl: 'https://cdn.shopify.com/2.jpg' },
			];

			mockPrismaFindUnique.mockResolvedValue(null);
			mockUploadImageFromUrlToR2
				.mockResolvedValueOnce('https://r2.example.com/1.jpg')
				.mockResolvedValueOnce('https://r2.example.com/2.jpg');
			mockPrismaUpsert.mockResolvedValue({});

			// Act
			const results = await backupProductImages(shopId, productId, images);

			// Assert
			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);
			expect(mockUploadImageFromUrlToR2).toHaveBeenCalledTimes(2);
		});

		it('should continue on individual failures', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const images = [
				{ mediaId: 'media1', shopifyUrl: 'https://cdn.shopify.com/1.jpg' },
				{ mediaId: 'media2', shopifyUrl: 'https://cdn.shopify.com/2.jpg' },
			];

			mockPrismaFindUnique.mockResolvedValue(null);
			mockUploadImageFromUrlToR2
				.mockRejectedValueOnce(new Error('Failed'))
				.mockResolvedValueOnce('https://r2.example.com/2.jpg');
			mockPrismaUpsert.mockResolvedValue({});

			// Act
			const results = await backupProductImages(shopId, productId, images);

			// Assert
			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(false);
			expect(results[1].success).toBe(true);
		});

		it('should return empty array for empty input', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const images: Array<{ mediaId: string; shopifyUrl: string }> = [];

			// Act
			const results = await backupProductImages(shopId, productId, images);

			// Assert
			expect(results).toHaveLength(0);
		});
	});

	describe('backupProductVariantImages (deprecated)', () => {
		it('should still work for backward compatibility', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const images = [
				{ mediaId: 'media1', shopifyUrl: 'https://cdn.shopify.com/1.jpg' },
			];

			mockPrismaFindUnique.mockResolvedValue(null);
			mockUploadImageFromUrlToR2.mockResolvedValue('https://r2.example.com/1.jpg');
			mockPrismaUpsert.mockResolvedValue({});

			// Act
			const results = await backupProductVariantImages(
				shopId,
				productId,
				variantId,
				images,
			);

			// Assert
			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(true);
		});
	});
});
