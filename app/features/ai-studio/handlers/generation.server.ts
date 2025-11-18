import { json } from '@remix-run/node';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import db, { lookupShopId } from '../../../db.server';
import { generateAIImage } from '../../../services/ai-providers.server';
import type { AspectRatio } from '../../../services/ai-providers';
import { AIStudioMediaService } from '../../../services/ai-studio-media.server';
import type { GenerateImageResponse, ActionErrorResponse } from '../types';

export async function handleGenerate(formData: FormData, shop: string, admin?: AdminApiContext) {
	const shopId = await lookupShopId(shop);
	if (!shopId) {
		throw new Error(`Unable to resolve shopId for shop: ${shop}`);
	}

	const requestId = crypto.randomUUID().slice(0, 8);
	console.log(`[HANDLER:${requestId}] handleGenerate called for shop: ${shop}`);

	const sourceImageUrl = String(formData.get('sourceImageUrl') || '');
	const prompt = String(formData.get('prompt') || '');
	const productId = String(formData.get('productId') || '');
	const aspectRatioRaw = String(formData.get('aspectRatio') || 'match_input_image');
	const validAspectRatios: AspectRatio[] = ['match_input_image', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'];
	const aspectRatio: AspectRatio = validAspectRatios.includes(aspectRatioRaw as AspectRatio)
		? (aspectRatioRaw as AspectRatio)
		: 'match_input_image';

	console.log(`[HANDLER:${requestId}] Parsed inputs:`, {
		sourceImageUrl: sourceImageUrl ? sourceImageUrl.substring(0, 50) + '...' : 'missing',
		prompt: prompt ? prompt.substring(0, 50) + '...' : 'missing',
		productId: productId || 'missing',
		aspectRatio,
		hasAdmin: !!admin,
	});

	if (!sourceImageUrl || !prompt) {
		console.error(`[HANDLER:${requestId}] Validation failed: missing sourceImageUrl or prompt`);
		const errorResponse: ActionErrorResponse = {
			ok: false,
			error: 'Missing sourceImageUrl or prompt',
		};
		return json(errorResponse, { status: 400 });
	}

	try {
		console.log(`[HANDLER:${requestId}] Calling generateAIImage...`);
		const result = await generateAIImage({
			sourceImageUrl,
			prompt,
			productId,
			modelType: 'swap',
			aspectRatio,
		});
		console.log(`[HANDLER:${requestId}] generateAIImage succeeded:`, {
			hasImageUrl: !!result.imageUrl,
			imageUrl: result.imageUrl ? result.imageUrl.substring(0, 50) + '...' : 'missing',
			id: result.id,
		});

		try {
			console.log(`[HANDLER:${requestId}] Logging metric event...`);
			await db.metricEvent.create({
				data: {
					id: crypto.randomUUID(),
					shop,
					shopId,
					eventType: 'GENERATED',
					productId,
					imageUrl: result.imageUrl,
				},
			});
			console.log(`[HANDLER:${requestId}] Metric event logged`);
		} catch (loggingError) {
			console.warn(`[HANDLER:${requestId}] Failed to log generation event:`, loggingError);
		}

		// Save to library instead of auto-publishing
		if (admin && productId) {
			try {
				console.log(`[HANDLER:${requestId}] Saving to library...`);

				const aiStudioMediaService = new AIStudioMediaService(admin, db);

				const savedImage = await aiStudioMediaService.saveToLibrary({
					shop,
					shopId,
					productId,
					url: result.imageUrl,
					source: "AI_GENERATED",
					prompt,
					sourceImageUrl,
					aiProvider: 'fal', // or detect from the provider used
				});

				console.log(
					`[HANDLER:${requestId}] ✓ Saved to library:`,
					savedImage.id
				);

				// Add library image info to the response
				result.libraryImageId = savedImage.id;
			} catch (saveError) {
				console.warn(`[HANDLER:${requestId}] Failed to save to library:`, saveError);
				// Don't fail the generation if saving to library fails
			}
		}

		const successResponse: GenerateImageResponse = {
			ok: true,
			result: {
				...result,
				originalSource: sourceImageUrl,
			},
		};

		console.log(`[HANDLER:${requestId}] Returning success response`);
		return json(successResponse);
	} catch (error: any) {
		console.error(`[HANDLER:${requestId}] AI image generation failed:`, {
			message: error?.message,
			stack: error?.stack,
			name: error?.constructor?.name,
			error,
		});

		// Check if this is an AIServiceError with friendly messaging
		const isAIServiceError =
			error?.name === 'AIServiceError' || (error?.code !== undefined && error?.details !== undefined);

		const friendlyMessage = isAIServiceError ? error.message : error?.message || 'AI image generation failed';

		const debugInfo: any = {
			sourceImageUrl,
			prompt,
			errorType: error?.constructor?.name || 'Unknown',
		};

		// Preserve original error details for logging/debugging
		if (isAIServiceError) {
			debugInfo.originalMessage = error.details?.originalMessage;
			debugInfo.errorCode = error.code;
			debugInfo.isSensitive = error.details?.isSensitive;
			debugInfo.provider = error.details?.provider;
		}

		const errorResponse: ActionErrorResponse = {
			ok: false,
			error: friendlyMessage,
			debug: debugInfo,
		};
		return json(errorResponse, { status: 500 });
	}
}
