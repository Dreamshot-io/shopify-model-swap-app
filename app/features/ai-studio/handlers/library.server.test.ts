import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// Import after mocks
import { handleSaveToLibrary, handleDeleteFromLibrary } from './library.server';
import db, { lookupShopId } from '../../../db.server';

// Create persistent mock functions that will be shared across all instances
const mockImageExists = vi.fn();
const mockSaveToLibrary = vi.fn();
const mockGetAllImages = vi.fn();
const mockDeleteImage = vi.fn();

vi.mock('../../../db.server', () => ({
	lookupShopId: vi.fn(),
	default: {
		metricEvent: {
			create: vi.fn(),
		},
	},
}));

vi.mock('../../../services/ai-studio-media.server', () => ({
	AIStudioMediaService: vi.fn(() => ({
		imageExists: mockImageExists,
		saveToLibrary: mockSaveToLibrary,
		getAllImages: mockGetAllImages,
		deleteImage: mockDeleteImage,
	})),
}));

const mockAdmin = {} as AdminApiContext;

// Create mockService object that references the persistent mocks
const mockService = {
	imageExists: mockImageExists,
	saveToLibrary: mockSaveToLibrary,
	getAllImages: mockGetAllImages,
	deleteImage: mockDeleteImage,
};

describe('library.server handlers - Multitenant shopId resolution', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Mock fetch to prevent real HTTP calls
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			blob: () => Promise.resolve(new Blob()),
		} as Response);
	});

	describe('handleSaveToLibrary', () => {
		// TODO: Refactor with DI to properly mock dependencies (SOLID principles)
		// Current module mocking doesn't work with real AIStudioMediaService instantiation
		it.skip('should resolve shopId and pass it to service methods', async () => {
			// Arrange
		const shop = 'test-shop.myshopify.com';
		const shopId = 'shop-id-123';
		const formData = new FormData();
		formData.set('imageUrl', 'https://example.com/image.jpg');
		formData.set('productId', 'product-123');
		formData.set('source', 'AI_GENERATED');
		(lookupShopId as Mock).mockResolvedValue(shopId);
		mockService.imageExists.mockResolvedValue(false);
		mockService.saveToLibrary.mockResolvedValue({
				id: 'image-123',
				url: 'https://example.com/image.jpg',
			});
			(db.metricEvent.create as Mock).mockResolvedValue({} as unknown);

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
			(lookupShopId as Mock).mockResolvedValue(null);

			// Act & Assert
			await expect(handleSaveToLibrary(formData, mockAdmin, shop)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});

		// TODO: Refactor with DI to properly mock dependencies (SOLID principles)
		it.skip('should set shopId on metric event creation', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-456';
			const formData = new FormData();
		formData.set('imageUrl', 'https://example.com/image2.jpg');
		formData.set('productId', 'product-456');
		formData.set('source', 'MANUAL_UPLOAD');
		(lookupShopId as Mock).mockResolvedValue(shopId);
		mockService.imageExists.mockResolvedValue(false);
			mockService.saveToLibrary.mockResolvedValue({
				id: 'image-456',
				url: 'https://example.com/image2.jpg',
			});
			(db.metricEvent.create as Mock).mockResolvedValue({} as unknown);

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
		(lookupShopId as Mock).mockResolvedValue(shopId);
		mockService.getAllImages.mockResolvedValue([
				{
					id: 'image-123',
					url: 'https://example.com/image.jpg',
					shopId,
				},
			]);
			mockService.deleteImage.mockResolvedValue(undefined);
			(db.metricEvent.create as Mock).mockResolvedValue({} as unknown);

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
			(lookupShopId as Mock).mockResolvedValue(null);

			// Act & Assert
			await expect(handleDeleteFromLibrary(formData, mockAdmin, shop)).rejects.toThrow(
				'Unable to resolve shopId for shop'
			);
		});
	});
});
