import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

async function deleteAllShopData(shopDomain: string) {
	const credential = await db.shopCredential.findUnique({
		where: { shopDomain },
		select: { id: true, mode: true },
	});

	if (!credential) {
		console.log(`[compliance] No credential found for ${shopDomain}, skipping data cleanup`);
		return { deleted: false, reason: "no_credential" };
	}

	const shopId = credential.id;

	const results = await db.$transaction(async (tx) => {
		// Models that use `shop` field with shopDomain
		const abTests = await tx.aBTest.deleteMany({ where: { shop: shopDomain } });
		const metricEvents = await tx.metricEvent.deleteMany({ where: { shop: shopDomain } });
		const generationHistory = await tx.generationHistory.deleteMany({ where: { shop: shopDomain } });
		const aiStudioImages = await tx.aIStudioImage.deleteMany({ where: { shop: shopDomain } });
		const productRules = await tx.productSuggestionRule.deleteMany({ where: { shop: shopDomain } });
		const auditLogs = await tx.auditLog.deleteMany({ where: { shop: shopDomain } });
		const sessions = await tx.session.deleteMany({ where: { shop: shopDomain } });

		// Models that use `shopId` FK (no `shop` field)
		const dailyStats = await tx.variantDailyStatistics.deleteMany({ where: { shopId } });
		const statsExports = await tx.statisticsExport.deleteMany({ where: { shopId } });
		const productInfo = await tx.productInfo.deleteMany({ where: { shopId } });

		let shopCredentialDeleted = { count: 0 };
		if (credential.mode === "PUBLIC") {
			shopCredentialDeleted = await tx.shopCredential.deleteMany({ where: { id: shopId } });
		}

		return {
			abTests: abTests.count,
			metricEvents: metricEvents.count,
			generationHistory: generationHistory.count,
			aiStudioImages: aiStudioImages.count,
			productRules: productRules.count,
			dailyStats: dailyStats.count,
			statsExports: statsExports.count,
			productInfo: productInfo.count,
			auditLogs: auditLogs.count,
			sessions: sessions.count,
			shopCredential: shopCredentialDeleted.count,
		};
	});

	return { deleted: true, counts: results };
}

export const action = async ({ request }: ActionFunctionArgs) => {
	const { topic, shop, payload } = await authenticate.webhook(request);

	console.log(`[compliance] Received ${topic} for ${shop}`);

	switch (topic) {
		case "CUSTOMERS_DATA_REQUEST": {
			console.log(`[compliance] customers/data_request for ${shop} - app stores no customer PII`);
			console.log(`[compliance] Request ID: ${payload?.data_request?.id}, Customer ID: ${payload?.customer?.id}`);
			break;
		}

		case "CUSTOMERS_REDACT": {
			console.log(`[compliance] customers/redact for ${shop} - app stores no customer PII`);
			console.log(`[compliance] Customer ID: ${payload?.customer?.id}`);
			break;
		}

		case "SHOP_REDACT": {
			console.log(`[compliance] shop/redact for ${shop} - deleting all shop data`);
			const result = await deleteAllShopData(shop);
			console.log(`[compliance] Shop data deletion result:`, JSON.stringify(result));
			break;
		}

		default:
			console.warn(`[compliance] Unknown topic: ${topic}`);
	}

	return new Response(null, { status: 200 });
};
