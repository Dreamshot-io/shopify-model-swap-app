/**
 * Tests for metrics calculator service
 * Following AAA (Arrange-Act-Assert) methodology
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import {
	calculateVariantMetrics,
	getVariantMetricsForDate,
	getZeroMetrics,
} from './metrics-calculator.service';
import type { ABTestEvent } from '@prisma/client';

// Mock Prisma client
const mockPrismaFindMany = vi.fn();

vi.mock('~/db.server', () => ({
	prisma: {
		aBTestEvent: {
			findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
		},
	},
}));

describe('metrics-calculator.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getZeroMetrics', () => {
		it('should return metrics with all zeros', () => {
			// Act
			const metrics = getZeroMetrics();

			// Assert
			expect(metrics).toEqual({
				impressions: 0,
				addToCarts: 0,
				ctr: 0,
				orders: 0,
				revenue: 0,
			});
		});
	});

	describe('calculateVariantMetrics', () => {
		it('should calculate metrics from events', () => {
			// Arrange
			const events: Partial<ABTestEvent>[] = [
				{ eventType: 'IMPRESSION', revenue: null, quantity: null },
				{ eventType: 'IMPRESSION', revenue: null, quantity: null },
				{ eventType: 'IMPRESSION', revenue: null, quantity: null },
				{ eventType: 'ADD_TO_CART', revenue: null, quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(29.99), quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(49.99), quantity: 2 },
			];

			// Act
			const metrics = calculateVariantMetrics(events as ABTestEvent[]);

			// Assert
			expect(metrics.impressions).toBe(3);
			expect(metrics.addToCarts).toBe(1);
			expect(metrics.orders).toBe(2);
			expect(metrics.revenue).toBe(79.98);
			expect(metrics.ctr).toBeCloseTo(0.3333, 4);
		});

		it('should return zero metrics for empty events', () => {
			// Arrange
			const events: ABTestEvent[] = [];

			// Act
			const metrics = calculateVariantMetrics(events);

			// Assert
			expect(metrics).toEqual({
				impressions: 0,
				addToCarts: 0,
				ctr: 0,
				orders: 0,
				revenue: 0,
			});
		});

		it('should handle zero impressions without division error', () => {
			// Arrange
			const events: Partial<ABTestEvent>[] = [
				{ eventType: 'ADD_TO_CART', revenue: null, quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(29.99), quantity: 1 },
			];

			// Act
			const metrics = calculateVariantMetrics(events as ABTestEvent[]);

			// Assert
			expect(metrics.impressions).toBe(0);
			expect(metrics.addToCarts).toBe(1);
			expect(metrics.ctr).toBe(0);
		});

		it('should calculate CTR correctly', () => {
			// Arrange - 10 impressions, 2 add to carts = 20% CTR
			const events: Partial<ABTestEvent>[] = [
				...Array(10).fill({ eventType: 'IMPRESSION', revenue: null, quantity: null }),
				{ eventType: 'ADD_TO_CART', revenue: null, quantity: 1 },
				{ eventType: 'ADD_TO_CART', revenue: null, quantity: 1 },
			];

			// Act
			const metrics = calculateVariantMetrics(events as ABTestEvent[]);

			// Assert
			expect(metrics.ctr).toBe(0.2); // 2/10 = 0.2
		});

		it('should sum revenue from multiple purchases', () => {
			// Arrange
			const events: Partial<ABTestEvent>[] = [
				{ eventType: 'PURCHASE', revenue: new Decimal(10.50), quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(20.25), quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(5.00), quantity: 1 },
			];

			// Act
			const metrics = calculateVariantMetrics(events as ABTestEvent[]);

			// Assert
			expect(metrics.revenue).toBe(35.75);
			expect(metrics.orders).toBe(3);
		});

		it('should handle null revenue values', () => {
			// Arrange
			const events: Partial<ABTestEvent>[] = [
				{ eventType: 'PURCHASE', revenue: null, quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(29.99), quantity: 1 },
			];

			// Act
			const metrics = calculateVariantMetrics(events as ABTestEvent[]);

			// Assert
			expect(metrics.revenue).toBe(29.99);
			expect(metrics.orders).toBe(2);
		});
	});

	describe('getVariantMetricsForDate', () => {
		it('should fetch and calculate metrics for specific date', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18');

			const mockEvents: Partial<ABTestEvent>[] = [
				{ eventType: 'IMPRESSION', revenue: null, quantity: null },
				{ eventType: 'IMPRESSION', revenue: null, quantity: null },
				{ eventType: 'ADD_TO_CART', revenue: null, quantity: 1 },
				{ eventType: 'PURCHASE', revenue: new Decimal(29.99), quantity: 1 },
			];

			mockPrismaFindMany.mockResolvedValue(mockEvents);

			// Act
			const metrics = await getVariantMetricsForDate(
				shopId,
				productId,
				variantId,
				date,
			);

			// Assert
			expect(metrics.impressions).toBe(2);
			expect(metrics.addToCarts).toBe(1);
			expect(metrics.orders).toBe(1);
			expect(metrics.revenue).toBe(29.99);
			expect(metrics.ctr).toBe(0.5);

			// Verify Prisma query
			expect(mockPrismaFindMany).toHaveBeenCalledWith({
				where: {
					productId,
					variantId,
					createdAt: {
						gte: expect.any(Date),
						lt: expect.any(Date),
					},
				},
			});
		});

		it('should return zero metrics if no events found', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18');

			mockPrismaFindMany.mockResolvedValue([]);

			// Act
			const metrics = await getVariantMetricsForDate(
				shopId,
				productId,
				variantId,
				date,
			);

			// Assert
			expect(metrics).toEqual(getZeroMetrics());
		});

		it('should query for correct date range (UTC)', async () => {
			// Arrange
			const shopId = 'shop123';
			const productId = 'prod456';
			const variantId = 'var789';
			const date = new Date('2025-11-18T00:00:00Z');

			mockPrismaFindMany.mockResolvedValue([]);

			// Act
			await getVariantMetricsForDate(shopId, productId, variantId, date);

			// Assert
			const call = mockPrismaFindMany.mock.calls[0][0];
			const startDate = call.where.createdAt.gte;
			const endDate = call.where.createdAt.lt;

			// Should be from 00:00:00 to 23:59:59.999 on the same day
			expect(startDate.toISOString()).toBe('2025-11-18T00:00:00.000Z');
			expect(endDate.toISOString()).toBe('2025-11-19T00:00:00.000Z');
		});
	});
});
