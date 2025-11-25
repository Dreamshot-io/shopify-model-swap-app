import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { AIStudioMediaService } from './ai-studio-media.server';
import * as dbModule from '../db.server';

vi.mock('../db.server', () => ({
	lookupShopId: vi.fn(),
	default: {
		aIStudioImage: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			count: vi.fn(),
		},
	},
}));

vi.mock('./media-gallery.server', () => ({
	MediaGalleryService: vi.fn().mockImplementation(() => ({
		validateMediaPresence: vi.fn().mockResolvedValue({ missing: [] }),
		ensureMediaInGallery: vi.fn().mockResolvedValue([
			{ success: true, mediaId: 'media-123' },
		]),
	})),
}));

const mockPrisma = {
	aIStudioImage: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		count: vi.fn(),
	},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAdmin = {} as any;

describe('AIStudioMediaService - Multitenant Query Filtering', () => {
	let service: AIStudioMediaService;

	beforeEach(() => {
		vi.clearAllMocks();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		service = new AIStudioMediaService(mockAdmin, mockPrisma as any);
	});

	describe('saveToLibrary', () => {
		it('should filter by shopId when checking for existing image', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const input = {
				shop,
				productId: 'product-123',
				url: 'https://example.com/image.jpg',
				source: 'AI_GENERATED' as const,
			};
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.findFirst as Mock).mockResolvedValue(null);
			(mockPrisma.aIStudioImage.create as Mock).mockResolvedValue({
				id: 'image-123',
				...input,
				shopId,
			});

			// Act
			await service.saveToLibrary(input);

			// Assert
			expect(mockPrisma.aIStudioImage.findFirst as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId: input.productId,
					url: input.url,
				},
			});
		});

		it('should set shopId when creating new image', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-456';
			const input = {
				shop,
				productId: 'product-456',
				url: 'https://example.com/image2.jpg',
				source: 'MANUAL_UPLOAD' as const,
			};
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.findFirst as Mock).mockResolvedValue(null);
			(mockPrisma.aIStudioImage.create as Mock).mockResolvedValue({
				id: 'image-456',
				...input,
				shopId,
			});

			// Act
			await service.saveToLibrary(input);

			// Assert
			expect(mockPrisma.aIStudioImage.create as Mock).toHaveBeenCalledWith({
				data: expect.objectContaining({
					shop,
					shopId,
					productId: input.productId,
					url: input.url,
				}),
			});
		});

		it('should use provided shopId when available', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-provided';
			const input = {
				shop,
				shopId,
				productId: 'product-789',
				url: 'https://example.com/image3.jpg',
				source: 'GALLERY_IMPORT' as const,
			};
			(mockPrisma.aIStudioImage.findFirst as Mock).mockResolvedValue(null);
			(mockPrisma.aIStudioImage.create as Mock).mockResolvedValue({
				id: 'image-789',
				...input,
			});

			// Act
			await service.saveToLibrary(input);

			// Assert
			expect(dbModule.lookupShopId).not.toHaveBeenCalled();
			expect(mockPrisma.aIStudioImage.findFirst as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId: input.productId,
					url: input.url,
				},
			});
		});

		it('should throw error when shopId cannot be resolved', async () => {
			// Arrange
			const shop = 'nonexistent-shop.myshopify.com';
			const input = {
				shop,
				productId: 'product-999',
				url: 'https://example.com/image.jpg',
				source: 'AI_GENERATED' as const,
			};
			(dbModule.lookupShopId as Mock).mockResolvedValue(null);

			// Act & Assert
			await expect(service.saveToLibrary(input)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});
	});

	describe('getLibraryImages', () => {
		it('should filter by shopId when querying library images', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const productId = 'product-123';
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.findMany as Mock).mockResolvedValue([]);

			// Act
			await service.getLibraryImages(shop, productId);

			// Assert
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					state: 'LIBRARY',
				},
				orderBy: { createdAt: 'desc' },
			});
		});

		it('should use provided shopId when available', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-provided';
			const productId = 'product-456';
			(mockPrisma.aIStudioImage.findMany as Mock).mockResolvedValue([]);

			// Act
			await service.getLibraryImages(shop, productId, undefined, shopId);

			// Assert
			expect(dbModule.lookupShopId).not.toHaveBeenCalled();
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					state: 'LIBRARY',
				},
				orderBy: { createdAt: 'desc' },
			});
		});
	});

	describe('getPublishedImages', () => {
		it('should filter by shopId when querying published images', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const productId = 'product-123';
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.findMany as Mock).mockResolvedValue([]);

			// Act
			await service.getPublishedImages(shop, productId);

			// Assert
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					state: 'PUBLISHED',
				},
				orderBy: { publishedAt: 'desc' },
			});
		});

		it('should throw error when shopId cannot be resolved', async () => {
			// Arrange
			const shop = 'nonexistent-shop.myshopify.com';
			const productId = 'product-123';
			(dbModule.lookupShopId as Mock).mockResolvedValue(null);

			// Act & Assert
			await expect(service.getPublishedImages(shop, productId)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});
	});

	describe('imageExists', () => {
		it('should filter by shopId when checking image existence', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const productId = 'product-123';
			const url = 'https://example.com/image.jpg';
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.count as Mock).mockResolvedValue(1);

			// Act
			const result = await service.imageExists(shop, productId, url);

			// Assert
			expect(mockPrisma.aIStudioImage.count as Mock).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					url,
				},
			});
			expect(result).toBe(true);
		});

		it('should return false when image does not exist', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const productId = 'product-123';
			const url = 'https://example.com/image.jpg';
			(dbModule.lookupShopId as Mock).mockResolvedValue(shopId);
			(mockPrisma.aIStudioImage.count as Mock).mockResolvedValue(0);

			// Act
			const result = await service.imageExists(shop, productId, url);

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('deleteImage', () => {
		it('should verify shopId matches before deleting', async () => {
			// Arrange
			const imageId = 'image-123';
			const shopId = 'shop-id-123';
			const image = {
				id: imageId,
				shopId,
				state: 'LIBRARY' as const,
				mediaId: null,
			};
			(mockPrisma.aIStudioImage.findUnique).mockResolvedValue(image as unknown);
			(mockPrisma.aIStudioImage.delete as Mock).mockResolvedValue(image as unknown);

			// Act
			await service.deleteImage(imageId, shopId);

			// Assert
			expect(mockPrisma.aIStudioImage.findUnique).toHaveBeenCalledWith({
				where: { id: imageId },
			});
			expect(mockPrisma.aIStudioImage.delete as Mock).toHaveBeenCalledWith({
				where: { id: imageId },
			});
		});

		it('should throw error when shopId does not match', async () => {
			// Arrange
			const imageId = 'image-123';
			const shopId = 'shop-id-123';
			const wrongShopId = 'shop-id-456';
			const image = {
				id: imageId,
				shopId,
				state: 'LIBRARY' as const,
				mediaId: null,
			};
			(mockPrisma.aIStudioImage.findUnique).mockResolvedValue(image as unknown);

			// Act & Assert
			await expect(service.deleteImage(imageId, wrongShopId)).rejects.toThrow(
				'does not belong to shop'
			);
		});
	});

	describe('test isolation - multiple shops', () => {
		it('should isolate queries between different shops', async () => {
			// Arrange
			const shop1 = 'shop1.myshopify.com';
			const shopId1 = 'shop-id-1';
			const shop2 = 'shop2.myshopify.com';
			const shopId2 = 'shop-id-2';
			const productId = 'product-123';

			(dbModule.lookupShopId as Mock)
				.mockResolvedValueOnce(shopId1)
				.mockResolvedValueOnce(shopId2);
			(mockPrisma.aIStudioImage.findMany as Mock).mockResolvedValue([]);

			// Act
			await service.getLibraryImages(shop1, productId);
			await service.getLibraryImages(shop2, productId);

			// Assert
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenCalledTimes(2);
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenNthCalledWith(1, {
				where: {
					shopId: shopId1,
					productId,
					state: 'LIBRARY',
				},
				orderBy: { createdAt: 'desc' },
			});
			expect(mockPrisma.aIStudioImage.findMany as Mock).toHaveBeenNthCalledWith(2, {
				where: {
					shopId: shopId2,
					productId,
					state: 'LIBRARY',
				},
				orderBy: { createdAt: 'desc' },
			});
		});
	});
});
