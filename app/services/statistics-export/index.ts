/**
 * Statistics export services
 * Public API for statistics export functionality
 */

export {
	exportProductVariantStatistics,
	exportProductStatistics,
	type ExportVariantParams,
	type ExportVariantResult,
} from './statistics-export-orchestrator.service';

export {
	generateStatisticsR2Key,
	uploadStatisticsExport,
} from './export-storage.service';

export {
	formatStatisticsToCSV,
	formatStatisticsToJSON,
	formatCSVRow,
} from './export-formatter.service';

export {
	getAllShopProducts,
	getProductVariants,
	getProductImages,
	type ShopifyProduct,
	type ShopifyVariant,
	type ShopifyImage,
} from './product-fetcher.service';

export {
	calculateVariantMetrics,
	getVariantMetricsForDate,
	getZeroMetrics,
} from './metrics-calculator.service';

export {
	generateR2Key,
	backupImageToR2,
	isImageBackedUp,
	backupProductVariantImages,
} from './image-backup.service';

export {
	saveVariantStatistics,
	getVariantStatistics,
	getProductStatisticsHistory,
	type SaveVariantStatisticsParams,
} from './statistics-persistence.service';
