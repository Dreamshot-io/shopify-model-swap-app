import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSaveToLibrary, handleDeleteFromLibrary } from './library.server';
import db, { lookupShopId } from '../../../db.server';
import { AIStudioMediaService } from '../../../services/ai-studio-media.server';

vi.mock('../../../db.server', async () => {
	const actual = await vi.importActual('../../../db.server');
	return {
		...actual,
		lookupShopId: vi.fn(),
		default: {
			metricEvent: {
				create: vi.fn(),
			},
		},
	};
});

vi.mock('../../../services/ai-studio-media.server', () => ({
	AIStudioMediaService: vi.fn().mockImplementation(() => ({
		imageExists: vi.fn(),
		saveToLibrary: vi.fn(),
		getAllImages: vi.fn(),
		deleteImage: vi.fn(),
	})),
}));

const mockAdmin = {} as any;

describe('library.server handlers - Multitenant shopId resolution', () => {
	let mockService: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockService = {
			imageExists: vi.fn(),
			saveToLibrary: vi.fn(),
			getAllImages: vi.fn(),
			deleteImage: vi.fn(),
		};
		vi.mocked(AIStudioMediaService).mockImplementation(() => mockService);
	});

	describe('handleSaveToLibrary', () => {
		it('should resolve shopId and pass it to service methods', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const formData = new FormData();
			formData.set('imageUrl', 'https://example.com/image.jpg');
			formData.set('productId', 'product-123');
			formData.set('source', 'AI_GENERATED');
			vi.mocked(lookupShopId).mockResolvedValue(shopId);
			mockService.imageExists.mockResolvedValue(false);
			mockService.saveToLibrary.mockResolvedValue({
				id: 'image-123',
				url: 'https://example.com/image.jpg',
			});
			vi.mocked(db.metricEvent.create).mockResolvedValue({});

			// Act
			const result = await handleSaveToLibrary(formData, mockAdmin, shop);

			// Assert
			expect(lookupShopId).toHaveBeenCalledWith(shop);
			expect(mockService.imageExists).toHaveBeenCalledWith(
				shop,
				'product-123',
				'https://example.com/image.jpg',
				shopId
			);
			expect(mockService.saveToLibrary).toHaveBeenCalledWith(
				expect.objectContaining({
					shop,
					shopId,
				})
			);
			expect(db.metricEvent.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					shop,
					shopId,
					eventType: 'SAVED_TO_LIBRARY',
				}),
			});
		});

		it('should throw error when shopId cannot be resolved', async () => {
			// Arrange
			const shop = 'nonexistent-shop.myshopify.com';
			const formData = new FormData();
			formData.set('imageUrl', 'https://example.com/image.jpg');
			formData.set('productId', 'product-123');
			vi.mocked(lookupShopId).mockResolvedValue(null);

			// Act & Assert
			await expect(handleSaveToLibrary(formData, mockAdmin, shop)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});

		it('should set shopId on metric event creation', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-456';
			const formData = new FormData();
			formData.set('imageUrl', 'https://example.com/image2.jpg');
			formData.set('productId', 'product-456');
			formData.set('source', 'MANUAL_UPLOAD');
			vi.mocked(lookupShopId).mockResolvedValue(shopId);
			mockService.imageExists.mockResolvedValue(false);
			mockService.saveToLibrary.mockResolvedValue({
				id: 'image-456',
				url: 'https://example.com/image2.jpg',
			});
			vi.mocked(db.metricEvent.create).mockResolvedValue({});

			// Act
			await handleSaveToLibrary(formData, mockAdmin, shop);

			// Assert
			expect(db.metricEvent.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					shop,
					shopId,
					eventType: 'SAVED_TO_LIBRARY',
					productId: 'product-456',
					imageUrl: 'https://example.com/image2.jpg',
				}),
			});
		});
	});

	describe('handleDeleteFromLibrary', () => {
		it('should resolve shopId and pass it to service methods', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			const formData = new FormData();
			formData.set('imageUrl', 'https://example.com/image.jpg');
			formData.set('productId', 'product-123');
			vi.mocked(lookupShopId).mockResolvedValue(shopId);
			mockService.getAllImages.mockResolvedValue([
				{
					id: 'image-123',
					url: 'https://example.com/image.jpg',
					shopId,
				},
			]);
			mockService.deleteImage.mockResolvedValue(undefined);
			vi.mocked(db.metricEvent.create).mockResolvedValue({});

			// Act
			const result = await handleDeleteFromLibrary(formData, mockAdmin, shop);

			// Assert
			expect(lookupShopId).toHaveBeenCalledWith(shop);
			expect(mockService.getAllImages).toHaveBeenCalledWith(
				shop,
				'product-123',
				undefined,
				shopId
			);
			expect(mockService.deleteImage).toHaveBeenCalledWith('image-123', shopId);
			expect(db.metricEvent.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					shop,
					shopId,
					eventType: 'DRAFT_DELETED',
				}),
			});
		});

		it('should throw error when shopId cannot be resolved', async () => {
			// Arrange
			const shop = 'nonexistent-shop.myshopify.com';
			const formData = new FormData();
			formData.set('imageUrl', 'https://example.com/image.jpg');
			formData.set('productId', 'product-123');
			vi.mocked(lookupShopId).mockResolvedValue(null);

			// Act & Assert
			await expect(handleDeleteFromLibrary(formData, mockAdmin, shop)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});
	});
});
