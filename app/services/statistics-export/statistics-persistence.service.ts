/**
 * Statistics persistence service
 * Handles saving and querying variant daily statistics from database
 */

import prisma from '~/db.server';
import type { VariantDailyStatistics, ProductImageBackup } from '@prisma/client';

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
	imageBackupIds?: string[];
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
	const { exportId, shopId, productId, variantId, date, metrics, imageBackupIds } = params;

	// Calculate derived metrics
	const conversionRate = calculateConversionRate(metrics.orders, metrics.impressions);

	// Build data object
	const data: {
		exportId: string;
		shop: string;
		productId: string;
		variantId: string;
		date: Date;
		impressions: number;
		addToCarts: number;
		ctr: number;
		orders: number;
		revenue: number;
		conversionRate: number;
		imageBackups?: { connect: { id: string }[] };
	} = {
		exportId,
		shop: shopId,
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

	// Add image backups if provided
	if (imageBackupIds && imageBackupIds.length > 0) {
		data.imageBackups = {
			connect: imageBackupIds.map((id) => ({ id })),
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
			imageBackups: ProductImageBackup[];
	  })
	| null
> {
	return prisma.variantDailyStatistics.findUnique({
		where: {
			shop_productId_variantId_date: {
				shop: shopId,
				productId,
				variantId,
				date,
			},
		},
		include: {
			imageBackups: true,
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
		imageBackups: ProductImageBackup[];
	})[]
> {
	return prisma.variantDailyStatistics.findMany({
		where: {
			shop: shopId,
			productId,
			...(variantId ? { variantId } : {}),
			date: {
				gte: startDate,
				lte: endDate,
			},
		},
		include: {
			imageBackups: true,
		},
		orderBy: {
			date: 'asc',
		},
	});
}
