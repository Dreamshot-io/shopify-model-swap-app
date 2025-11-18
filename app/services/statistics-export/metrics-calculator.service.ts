/**
 * Metrics calculator service for statistics exports
 * Calculates impressions, ATC, CTR, orders, and revenue from events
 */

import type { ABTestEvent } from '@prisma/client';
import { prisma } from '~/db.server';
import type { VariantMetrics } from '~/features/statistics-export/types';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Get zero-initialized metrics
 */
export function getZeroMetrics(): VariantMetrics {
	return {
		impressions: 0,
		addToCarts: 0,
		ctr: 0,
		orders: 0,
		revenue: 0,
	};
}

/**
 * Calculate metrics from an array of events
 */
export function calculateVariantMetrics(events: ABTestEvent[]): VariantMetrics {
	if (events.length === 0) {
		return getZeroMetrics();
	}

	let impressions = 0;
	let addToCarts = 0;
	let orders = 0;
	let totalRevenue = 0;

	for (const event of events) {
		switch (event.eventType) {
			case 'IMPRESSION':
				impressions++;
				break;
			case 'ADD_TO_CART':
				addToCarts++;
				break;
			case 'PURCHASE':
				orders++;
				if (event.revenue) {
					const revenueValue =
						event.revenue instanceof Decimal
							? parseFloat(event.revenue.toString())
							: event.revenue;
					totalRevenue += revenueValue;
				}
				break;
		}
	}

	// Calculate CTR (avoid division by zero)
	const ctr = impressions > 0 ? addToCarts / impressions : 0;

	return {
		impressions,
		addToCarts,
		ctr,
		orders,
		revenue: totalRevenue,
	};
}

/**
 * Get metrics for a specific variant on a specific date
 * Date is in UTC
 */
export async function getVariantMetricsForDate(
	shopId: string,
	productId: string,
	variantId: string,
	date: Date,
): Promise<VariantMetrics> {
	// Get start of day (00:00:00 UTC)
	const startOfDay = new Date(date);
	startOfDay.setUTCHours(0, 0, 0, 0);

	// Get start of next day (00:00:00 UTC next day)
	const startOfNextDay = new Date(startOfDay);
	startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

	// Query events for this variant on this date
	const events = await prisma.aBTestEvent.findMany({
		where: {
			productId,
			variantId,
			createdAt: {
				gte: startOfDay,
				lt: startOfNextDay,
			},
		},
	});

	return calculateVariantMetrics(events);
}
