/**
 * Tests for product fetcher service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getAllShopProducts,
	getProductVariants,
	getProductImages,
} from './product-fetcher.service';

// Mock GraphQL admin
const mockGraphql = vi.fn();

describe('product-fetcher.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getAllShopProducts', () => {
		it('should fetch all products from Shopify', async () => {
			// Arrange
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						products: {
							edges: [
								{
									node: {
										id: 'gid://shopify/Product/1',
										title: 'Product 1',
										status: 'ACTIVE',
									},
								},
								{
									node: {
										id: 'gid://shopify/Product/2',
										title: 'Product 2',
										status: 'ACTIVE',
									},
								},
							],
						},
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const products = await getAllShopProducts(mockGraphql as never);

			// Assert
			expect(products).toHaveLength(2);
			expect(products[0]).toEqual({
				id: 'gid://shopify/Product/1',
				title: 'Product 1',
				status: 'ACTIVE',
			});
			expect(mockGraphql).toHaveBeenCalledWith(
				expect.stringContaining('query GetProducts'),
				expect.any(Object),
			);
		});

		it('should return empty array if no products', async () => {
			// Arrange
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						products: {
							edges: [],
						},
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const products = await getAllShopProducts(mockGraphql as never);

			// Assert
			expect(products).toEqual([]);
		});

		it('should throw error on GraphQL failure', async () => {
			// Arrange
			const error = new Error('GraphQL error');
			mockGraphql.mockRejectedValue(error);

			// Act & Assert
			await expect(getAllShopProducts(mockGraphql as never)).rejects.toThrow(
				'GraphQL error',
			);
		});
	});

	describe('getProductVariants', () => {
		it('should fetch variants for a product', async () => {
			// Arrange
			const productId = 'gid://shopify/Product/1';
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						product: {
							id: productId,
							title: 'Test Product',
							variants: {
								nodes: [
									{
										id: 'gid://shopify/ProductVariant/1',
										title: 'Small',
										displayName: 'Test Product - Small',
									},
									{
										id: 'gid://shopify/ProductVariant/2',
										title: 'Large',
										displayName: 'Test Product - Large',
									},
								],
							},
						},
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const variants = await getProductVariants(mockGraphql as never, productId);

			// Assert
			expect(variants).toHaveLength(2);
			expect(variants[0]).toEqual({
				id: 'gid://shopify/ProductVariant/1',
				title: 'Small',
				displayName: 'Test Product - Small',
			});
			expect(mockGraphql).toHaveBeenCalledWith(
				expect.stringContaining('query GetProductVariants'),
				expect.objectContaining({
					variables: { productId },
				}),
			);
		});

		it('should return empty array if product not found', async () => {
			// Arrange
			const productId = 'gid://shopify/Product/999';
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						product: null,
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const variants = await getProductVariants(mockGraphql as never, productId);

			// Assert
			expect(variants).toEqual([]);
		});
	});

	describe('getProductImages', () => {
		it('should fetch images for a product', async () => {
			// Arrange
			const productId = 'gid://shopify/Product/1';
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						product: {
							id: productId,
							media: {
								nodes: [
									{
										id: 'gid://shopify/MediaImage/1',
										image: {
											url: 'https://cdn.shopify.com/image1.jpg',
											altText: 'Image 1',
										},
									},
									{
										id: 'gid://shopify/MediaImage/2',
										image: {
											url: 'https://cdn.shopify.com/image2.jpg',
											altText: 'Image 2',
										},
									},
								],
							},
						},
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const images = await getProductImages(mockGraphql as never, productId);

			// Assert
			expect(images).toHaveLength(2);
			expect(images[0]).toEqual({
				mediaId: 'gid://shopify/MediaImage/1',
				url: 'https://cdn.shopify.com/image1.jpg',
				altText: 'Image 1',
			});
			expect(mockGraphql).toHaveBeenCalledWith(
				expect.stringContaining('query GetProductMedia'),
				expect.objectContaining({
					variables: { productId },
				}),
			);
		});

		it('should filter out non-image media', async () => {
			// Arrange
			const productId = 'gid://shopify/Product/1';
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						product: {
							id: productId,
							media: {
								nodes: [
									{
										id: 'gid://shopify/MediaImage/1',
										image: {
											url: 'https://cdn.shopify.com/image1.jpg',
											altText: 'Image 1',
										},
									},
									{
										id: 'gid://shopify/Video/1',
										// No image property - this is a video
									},
								],
							},
						},
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const images = await getProductImages(mockGraphql as never, productId);

			// Assert
			expect(images).toHaveLength(1);
			expect(images[0].mediaId).toBe('gid://shopify/MediaImage/1');
		});

		it('should return empty array if product not found', async () => {
			// Arrange
			const productId = 'gid://shopify/Product/999';
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: {
						product: null,
					},
				}),
			};

			mockGraphql.mockResolvedValue(mockResponse);

			// Act
			const images = await getProductImages(mockGraphql as never, productId);

			// Assert
			expect(images).toEqual([]);
		});
	});
});
