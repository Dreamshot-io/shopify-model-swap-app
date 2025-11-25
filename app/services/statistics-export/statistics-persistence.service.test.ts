/**
 * Tests for statistics persistence service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma client
const mockPrismaCreate = vi.fn();
const mockPrismaFindUnique = vi.fn();
const mockPrismaFindMany = vi.fn();
const mockPrismaUpdate = vi.fn();
const mockPrismaTransaction = vi.fn();

vi.mock('~/db.server', () => ({
	default: {
		variantDailyStatistics: {
			create: (...args: unknown[]) => mockPrismaCreate(...args),
			findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
			findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
			update: (...args: unknown[]) => mockPrismaUpdate(...args),
		},
		$transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
	},
}));

// Import after mocks
const {
	saveVariantStatistics,
	getVariantStatistics,
	getProductStatisticsHistory,
} = await import('./statistics-persistence.service');

describe('statistics-persistence.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('saveVariantStatistics', () => {
		it('should create VariantDailyStatistics with correct metrics', async () => {
			// Arrange
			const exportId = 'exp123';
			const shopId = 'shop.myshopify.com';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-01-15T00:00:00Z');
			const metrics = {
				impressions: 100,
				addToCarts: 10,
				ctr: 0.1,
				orders: 5,
				revenue: 250.5,
			};

			const expectedRecord = {
				id: 'stat123',
				exportId,
				shop: shopId,
				productId,
				variantId,
				date,
				...metrics,
				conversionRate: 0.05,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaCreate.mockResolvedValueOnce(expectedRecord);

			// Act
			const result = await saveVariantStatistics({
				exportId,
				shopId,
				productId,
				variantId,
				date,
				metrics,
			});

			// Assert
			expect(result).toEqual(expectedRecord);
			expect(mockPrismaCreate).toHaveBeenCalledWith({
				data: {
					exportId,
					shopId,
					productId,
					variantId,
					date,
					impressions: 100,
					addToCarts: 10,
					ctr: 0.1,
					orders: 5,
					revenue: 250.5,
					conversionRate: 0.05,
				},
			});
		});

		it('should calculate conversionRate correctly', async () => {
			// Arrange
			const params = {
				exportId: 'exp123',
				shopId: 'shop.myshopify.com',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-01-15'),
				metrics: {
					impressions: 200,
					addToCarts: 20,
					ctr: 0.1,
					orders: 8,
					revenue: 400,
				},
			};

			mockPrismaCreate.mockResolvedValueOnce({
				id: 'stat123',
				...params,
				conversionRate: 0.04,
			});

			// Act
			await saveVariantStatistics(params);

			// Assert
			expect(mockPrismaCreate).toHaveBeenCalledWith({
				data: expect.objectContaining({
					conversionRate: 0.04, // 8 / 200
				}),
			});
		});

		it('should handle zero impressions gracefully', async () => {
			// Arrange
			const params = {
				exportId: 'exp123',
				shopId: 'shop.myshopify.com',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-01-15'),
				metrics: {
					impressions: 0,
					addToCarts: 0,
					ctr: 0,
					orders: 0,
					revenue: 0,
				},
			};

			mockPrismaCreate.mockResolvedValueOnce({
				id: 'stat123',
				...params,
				conversionRate: 0,
			});

			// Act
			await saveVariantStatistics(params);

			// Assert
			expect(mockPrismaCreate).toHaveBeenCalledWith({
				data: expect.objectContaining({
					conversionRate: 0,
					ctr: 0,
				}),
			});
		});

		it('should link product info using connect', async () => {
			// Arrange
			const params = {
				exportId: 'exp123',
				shopId: 'shop.myshopify.com',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-01-15'),
				metrics: {
					impressions: 100,
					addToCarts: 10,
					ctr: 0.1,
					orders: 5,
					revenue: 250,
				},
				productInfoIds: ['img1', 'img2', 'img3'],
			};

			mockPrismaCreate.mockResolvedValueOnce({
				id: 'stat123',
				...params,
			});

			// Act
			await saveVariantStatistics(params);

			// Assert
			expect(mockPrismaCreate).toHaveBeenCalledWith({
				data: expect.objectContaining({
					productInfo: {
						connect: [{ id: 'img1' }, { id: 'img2' }, { id: 'img3' }],
					},
				}),
			});
		});

		it('should handle missing productInfoIds gracefully', async () => {
			// Arrange
			const params = {
				exportId: 'exp123',
				shopId: 'shop.myshopify.com',
				productId: 'prod456',
				variantId: 'var789',
				date: new Date('2025-01-15'),
				metrics: {
					impressions: 100,
					addToCarts: 10,
					ctr: 0.1,
					orders: 5,
					revenue: 250,
				},
			};

			mockPrismaCreate.mockResolvedValueOnce({ id: 'stat123' });

			// Act
			await saveVariantStatistics(params);

			// Assert
			expect(mockPrismaCreate).toHaveBeenCalledWith({
				data: expect.not.objectContaining({
					productInfo: expect.anything(),
				}),
			});
		});
	});

	describe('getVariantStatistics', () => {
		it('should retrieve statistics with productInfo included', async () => {
			// Arrange
			const shopId = 'shop.myshopify.com';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-01-15T00:00:00Z');

			const mockStatistics = {
				id: 'stat123',
				shopId,
				productId,
				variantId,
				date,
				impressions: 100,
				addToCarts: 10,
				ctr: 0.1,
				orders: 5,
				revenue: 250.5,
				conversionRate: 0.05,
				productInfo: [
					{
						id: 'img1',
						mediaId: 'media123',
						shopifyUrl: 'https://cdn.shopify.com/image1.jpg',
						r2Url: 'https://r2.cloudflare.com/image1.jpg',
					},
				],
			};

			mockPrismaFindUnique.mockResolvedValueOnce(mockStatistics);

			// Act
			const result = await getVariantStatistics(shopId, productId, variantId, date);

			// Assert
			expect(result).toEqual(mockStatistics);
			expect(mockPrismaFindUnique).toHaveBeenCalledWith({
				where: {
					shopId_productId_variantId_date: {
						shopId,
						productId,
						variantId,
						date,
					},
				},
				include: {
					productInfo: true,
				},
			});
		});

		it('should return null if statistics not found', async () => {
			// Arrange
			mockPrismaFindUnique.mockResolvedValueOnce(null);

			// Act
			const result = await getVariantStatistics(
				'shop.myshopify.com',
				'prod456',
				'var789',
				new Date('2025-01-15'),
			);

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('getProductStatisticsHistory', () => {
		it('should fetch statistics for date range', async () => {
			// Arrange
			const shopId = 'shop.myshopify.com';
			const productId = 'prod456';
			const startDate = new Date('2025-01-01');
			const endDate = new Date('2025-01-07');

			const mockHistory = [
				{
					id: 'stat1',
					shop: shopId,
					productId,
					variantId: 'var1',
					date: new Date('2025-01-01'),
					impressions: 100,
					revenue: 200,
				},
				{
					id: 'stat2',
					shop: shopId,
					productId,
					variantId: 'var1',
					date: new Date('2025-01-02'),
					impressions: 150,
					revenue: 300,
				},
			];

			mockPrismaFindMany.mockResolvedValueOnce(mockHistory);

			// Act
			const result = await getProductStatisticsHistory(shopId, productId, startDate, endDate);

			// Assert
			expect(result).toEqual(mockHistory);
			expect(mockPrismaFindMany).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					date: {
						gte: startDate,
						lte: endDate,
					},
				},
				include: {
					productInfo: true,
				},
				orderBy: {
					date: 'asc',
				},
			});
		});

		it('should filter by variantId when provided', async () => {
			// Arrange
			const shopId = 'shop.myshopify.com';
			const productId = 'prod456';
			const variantId = 'var789';
			const startDate = new Date('2025-01-01');
			const endDate = new Date('2025-01-07');

			mockPrismaFindMany.mockResolvedValueOnce([]);

			// Act
			await getProductStatisticsHistory(shopId, productId, startDate, endDate, variantId);

			// Assert
			expect(mockPrismaFindMany).toHaveBeenCalledWith({
				where: {
					shopId,
					productId,
					variantId,
					date: {
						gte: startDate,
						lte: endDate,
					},
				},
				include: {
					productInfo: true,
				},
				orderBy: {
					date: 'asc',
				},
			});
		});

		it('should return empty array if no statistics found', async () => {
			// Arrange
			mockPrismaFindMany.mockResolvedValueOnce([]);

			// Act
			const result = await getProductStatisticsHistory(
				'shop.myshopify.com',
				'prod456',
				new Date('2025-01-01'),
				new Date('2025-01-07'),
			);

			// Assert
			expect(result).toEqual([]);
		});
	});
});
