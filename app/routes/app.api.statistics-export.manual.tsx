/**
 * Manual statistics export API route
 * Allows triggering statistics export for specific products/variants
 */

import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { lookupShopId } from '../db.server';
import { exportProductVariantStatistics } from '~/services/statistics-export';

export const action = async ({ request }: ActionFunctionArgs) => {
	try {
		const { admin, session } = await authenticate.admin(request);

		const shopId = await lookupShopId(session.shop);
		if (!shopId) {
			return json({ error: 'Shop not found' }, { status: 404 });
		}

		// Parse request body
		const formData = await request.formData();
		const productId = formData.get('productId') as string;
		const shopifyProductId = formData.get('shopifyProductId') as string;
		const variantId = formData.get('variantId') as string;
		const shopifyVariantId = formData.get('shopifyVariantId') as string;
		const dateStr = formData.get('date') as string | null;

		// Validate required fields
		if (!productId || !shopifyProductId || !variantId || !shopifyVariantId) {
			return json(
				{
					error: 'Missing required fields: productId, shopifyProductId, variantId, shopifyVariantId',
				},
				{ status: 400 },
			);
		}

		// Parse date (default to yesterday UTC if not provided)
		const date = dateStr
			? new Date(dateStr)
			: (() => {
					const yesterday = new Date();
					yesterday.setUTCDate(yesterday.getUTCDate() - 1);
					yesterday.setUTCHours(0, 0, 0, 0);
					return yesterday;
				})();

		// Generate export
		const result = await exportProductVariantStatistics({
			admin: admin.graphql,
			shopId,
			shopDomain: session.shop,
			productId,
			shopifyProductId,
			variantId,
			shopifyVariantId,
			date,
		});

		if (!result.success) {
			return json(
				{
					success: false,
					error: result.error,
				},
				{ status: 500 },
			);
		}

		return json({
			success: true,
			export: {
				variantId: result.variantId,
				date: date.toISOString().split('T')[0],
				csvUrl: result.csvUrl,
				jsonUrl: result.jsonUrl,
				csvR2Key: result.csvR2Key,
				jsonR2Key: result.jsonR2Key,
			},
		});
	} catch (error) {
		console.error('[statistics-export] Manual export failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 },
		);
	}
};
