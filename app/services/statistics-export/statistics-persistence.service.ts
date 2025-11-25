/**
 * Statistics persistence service
 * Handles saving and querying variant daily statistics from database
 */

import prisma from '~/db.server';
import type { VariantDailyStatistics, ProductInfo } from '@prisma/client';

/**
 * Parameters for saving variant statistics
 */
export interface SaveVariantStatisticsParams {
	exportId: string;
	shopId: string;
	productId: string;
	variantId: string;
	date: Date;
	metrics: {
		impressions: number;
		addToCarts: number;
		ctr: number;
		orders: number;
		revenue: number;
	};
	productInfoIds?: string[];
}

/**
 * Calculate conversion rate
 */
function calculateConversionRate(orders: number, impressions: number): number {
	if (impressions === 0) return 0;
	return orders / impressions;
}

/**
 * Save variant statistics to database
 */
export async function saveVariantStatistics(
	params: SaveVariantStatisticsParams,
): Promise<VariantDailyStatistics> {
	const { exportId, shopId, productId, variantId, date, metrics, productInfoIds } = params;

	// Calculate derived metrics
	const conversionRate = calculateConversionRate(metrics.orders, metrics.impressions);

	// Build data object
	const data: {
		exportId: string;
		shopId: string;
		productId: string;
		variantId: string;
		date: Date;
		impressions: number;
		addToCarts: number;
		ctr: number;
		orders: number;
		revenue: number;
		conversionRate: number;
		productInfo?: { connect: { id: string }[] };
	} = {
		exportId,
		shopId,
		productId,
		variantId,
		date,
		impressions: metrics.impressions,
		addToCarts: metrics.addToCarts,
		ctr: metrics.ctr,
		orders: metrics.orders,
		revenue: metrics.revenue,
		conversionRate,
	};

	// Add product info if provided
	if (productInfoIds && productInfoIds.length > 0) {
		data.productInfo = {
			connect: productInfoIds.map((id) => ({ id })),
		};
	}

	return prisma.variantDailyStatistics.create({
		data,
	});
}

/**
 * Get statistics for a specific variant on a specific date
 */
export async function getVariantStatistics(
	shopId: string,
	productId: string,
	variantId: string,
	date: Date,
): Promise<
	| (VariantDailyStatistics & {
			productInfo: ProductInfo[];
	  })
	| null
> {
	return prisma.variantDailyStatistics.findUnique({
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
}

/**
 * Get statistics history for a product within a date range
 */
export async function getProductStatisticsHistory(
	shopId: string,
	productId: string,
	startDate: Date,
	endDate: Date,
	variantId?: string,
): Promise<
	(VariantDailyStatistics & {
		productInfo: ProductInfo[];
	})[]
> {
	return prisma.variantDailyStatistics.findMany({
		where: {
			shopId,
			productId,
			...(variantId ? { variantId } : {}),
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
}
