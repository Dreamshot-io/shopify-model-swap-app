/**
 * Export storage service for statistics exports
 * Handles uploading CSV and JSON exports to R2 storage
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { R2_KEY_PREFIXES } from '~/features/statistics-export/constants';

/**
 * S3 client for R2 storage
 */
const s3Client = new S3Client({
	region: process.env.S3_REGION || 'auto',
	endpoint: process.env.S3_ENDPOINT,
	credentials: {
		accessKeyId: process.env.S3_ACCESS_KEY || '',
		secretAccessKey: process.env.S3_SECRET_KEY || '',
	},
	forcePathStyle: true,
});

/**
 * Format date as YYYYMMDD
 */
function formatDateForKey(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}${month}${day}`;
}

/**
 * Generate R2 key for statistics export
 * Format: statistic-exports/{shopId}/{productId}/{variantId}/YYYYMMDD.{ext}
 */
export function generateStatisticsR2Key(
	shopId: string,
	productId: string,
	variantId: string,
	date: Date,
	format: 'csv' | 'json',
): string {
	const dateStr = formatDateForKey(date);
	return `${R2_KEY_PREFIXES.STATISTICS_EXPORTS}/${shopId}/${productId}/${variantId}/${dateStr}.${format}`;
}

/**
 * Generate private R2 URL for object
 */
function getPrivateR2Url(bucket: string, key: string): string {
	const endpoint = process.env.S3_ENDPOINT;
	if (!endpoint) {
		throw new Error('S3_ENDPOINT is required');
	}

	const baseUrl = endpoint.replace(/\/$/, '');
	return `${baseUrl}/${bucket}/${key}`;
}

/**
 * Get content type for export format
 */
function getContentType(format: 'csv' | 'json'): string {
	return format === 'csv' ? 'text/csv' : 'application/json';
}

/**
 * Upload statistics export to R2 storage
 */
export async function uploadStatisticsExport(
	shopId: string,
	productId: string,
	variantId: string,
	date: Date,
	content: string,
	format: 'csv' | 'json',
): Promise<{
	success: boolean;
	r2Key: string;
	r2Url: string;
	error?: string;
}> {
	const r2Key = generateStatisticsR2Key(shopId, productId, variantId, date, format);

	try {
		const bucket = process.env.S3_BUCKET;
		if (!bucket) {
			throw new Error('S3_BUCKET is required');
		}

		const command = new PutObjectCommand({
			Bucket: bucket,
			Key: r2Key,
			Body: Buffer.from(content, 'utf-8'),
			ContentType: getContentType(format),
		});

		await s3Client.send(command);

		const r2Url = getPrivateR2Url(bucket, r2Key);

		return {
			success: true,
			r2Key,
			r2Url,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return {
			success: false,
			r2Key,
			r2Url: '',
			error: errorMessage,
		};
	}
}
