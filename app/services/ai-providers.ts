import { fal } from '@fal-ai/client';
import Replicate from 'replicate';
import type { AIServiceError } from '../features/ai-studio/types';
// Domain-driven design for AI image generation services

/**
 * Parse Replicate API errors and return user-friendly error messages
 * Maps specific error codes to friendly messages while preserving debug info
 */
function parseReplicateError(error: any): AIServiceError {
	const errorMessage = error?.message || String(error);
	const friendlyMessage = 'There is a problem with this image, please try a different one';

	// Extract error code from message (e.g., "E005" from "Prediction failed: ... (E005)")
	const codeMatch = errorMessage.match(/\(E\d+\)/);
	const errorCode = codeMatch ? codeMatch[0].slice(1, -1) : undefined;

	// Check for sensitive content flag
	const isSensitiveError =
		errorMessage.toLowerCase().includes('sensitive') || errorMessage.toLowerCase().includes('flagged');

	const parsedError: AIServiceError = new Error(friendlyMessage);
	parsedError.name = 'AIServiceError';
	parsedError.code = errorCode;
	parsedError.statusCode = error?.status;
	parsedError.details = {
		originalMessage: errorMessage,
		isSensitive: isSensitiveError,
		provider: 'replicate',
	};

	return parsedError;
}

export type AspectRatio = 'match_input_image' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16';

export interface AIImageRequest {
	sourceImageUrl: string;
	prompt: string;
	productId: string;
	modelType?: 'swap' | 'generate' | 'optimize';
	aspectRatio?: AspectRatio;
}

export interface AIImageResponse {
	imageUrl: string;
	id: string;
	confidence: number;
	metadata?: Record<string, any>;
}

export interface AIProvider {
	name: string;
	generateImage(request: AIImageRequest): Promise<AIImageResponse>;
	swapModel(request: AIImageRequest): Promise<AIImageResponse>;
	optimizeImage(request: AIImageRequest): Promise<AIImageResponse>;
}

// FAL.AI Implementation
export class FalAIProvider implements AIProvider {
	name = 'fal.ai';
	private readonly modelPath = 'fal-ai/gemini-25-flash-image/edit';

	constructor(private readonly apiKey: string) {
		if (this.apiKey) {
			fal.config({ credentials: this.apiKey });
		}
	}

	async generateImage(request: AIImageRequest): Promise<AIImageResponse> {
		// For this model, generate and swap are equivalent operations (image edit)
		return this.swapModel(request);
	}

	async swapModel(request: AIImageRequest): Promise<AIImageResponse> {
		const requestId = crypto.randomUUID().slice(0, 8);
		console.log(`[FAL_AI:${requestId}] swapModel called`);
		console.log(`[FAL_AI:${requestId}] Input:`, {
			prompt: request.prompt.substring(0, 50) + '...',
			sourceImageUrl: request.sourceImageUrl.substring(0, 50) + '...',
			modelPath: this.modelPath,
		});

		let result: any;
		try {
			console.log(`[FAL_AI:${requestId}] Calling fal.subscribe(${this.modelPath})...`);
			result = await fal.subscribe(this.modelPath, {
				input: {
					prompt: request.prompt,
					image_urls: [request.sourceImageUrl],
					output_format: 'jpeg',
					num_images: 1,
				},
				logs: true,
				onQueueUpdate: (update: any) => {
					if (update?.status === 'IN_PROGRESS' && Array.isArray(update?.logs)) {
						for (const log of update.logs) {
							console.log(`[FAL_AI:${requestId}]`, log.message || log);
						}
					}
				},
			});
			console.log(`[FAL_AI:${requestId}] fal.subscribe completed:`, {
				hasData: !!result?.data,
				hasImages: !!result?.data?.images,
				imagesLength: result?.data?.images?.length,
				requestId: result?.requestId,
			});
		} catch (apiError: any) {
			console.error(`[FAL_AI:${requestId}] fal.subscribe failed:`, {
				message: apiError?.message,
				status: apiError?.status,
				error: apiError,
			});
			throw apiError;
		}

		const firstImageUrl = result?.data?.images?.[0]?.url as string;
		console.log(`[FAL_AI:${requestId}] Processing result:`, {
			hasFirstImage: !!result?.data?.images?.[0],
			firstImageUrl: firstImageUrl ? firstImageUrl.substring(0, 50) + '...' : 'missing',
		});

		if (!firstImageUrl) {
			console.error(`[FAL_AI:${requestId}] No image URL found:`, { result });
			throw new Error('fal.ai did not return an image URL');
		}

		console.log(`[FAL_AI:${requestId}] ✓ Image URL extracted`);

		return {
			id: result.requestId || `fal_${Date.now()}`,
			imageUrl: firstImageUrl,
			confidence: 0.9,
			metadata: {
				provider: 'fal.ai',
				operation: 'image_edit',
				prompt: request.prompt,
				description: result?.data?.description,
			},
		};
	}

	async optimizeImage(request: AIImageRequest): Promise<AIImageResponse> {
		// Not specific to this model; fallback to generate
		return this.generateImage(request);
	}
}

// Replicate (Seedream 4) Implementation
export class ReplicateProvider implements AIProvider {
	name = 'replicate';
	private readonly modelPath = 'bytedance/seedream-4';
	private replicate: Replicate;

	constructor(private readonly apiToken: string) {
		this.replicate = new Replicate({
			auth: this.apiToken,
		});
	}

	async generateImage(request: AIImageRequest): Promise<AIImageResponse> {
		const requestId = crypto.randomUUID().slice(0, 8);
		console.log(`[REPLICATE:${requestId}] generateImage called`);
		console.log(`[REPLICATE:${requestId}] Input:`, {
			prompt: request.prompt.substring(0, 50) + '...',
			sourceImageUrl: request.sourceImageUrl.substring(0, 50) + '...',
			aspectRatio: request.aspectRatio,
			modelPath: this.modelPath,
		});

		const input = {
			prompt: request.prompt,
			image_input: [request.sourceImageUrl],
			aspect_ratio: request.aspectRatio || 'match_input_image',
			size: '4K',
			enhance_prompt: true,
			max_images: 1,
			sequential_image_generation: 'disabled',
		};

		console.log(`[REPLICATE:${requestId}] Calling replicate.run(${this.modelPath})...`);
		let output: any[];
		try {
			output = (await this.replicate.run(this.modelPath, { input })) as any[];
			console.log(`[REPLICATE:${requestId}] Replicate API call completed:`, {
				outputType: Array.isArray(output) ? 'array' : typeof output,
				outputLength: Array.isArray(output) ? output.length : 'N/A',
				firstItemType: Array.isArray(output) && output[0] ? typeof output[0] : 'N/A',
			});
		} catch (apiError: any) {
			console.error(`[REPLICATE:${requestId}] Replicate API call failed:`, {
				message: apiError?.message,
				status: apiError?.status,
				statusText: apiError?.statusText,
				response: apiError?.response,
				error: apiError,
			});
			// Transform Replicate errors into user-friendly AIServiceError
			throw parseReplicateError(apiError);
		}

		if (!output || !Array.isArray(output) || output.length === 0) {
			console.error(`[REPLICATE:${requestId}] Invalid output:`, { output });
			throw new Error('Replicate did not return any images');
		}

		const firstImage = output[0];
		let firstImageValue = 'N/A';
		try {
			if (typeof firstImage === 'object' && firstImage !== null) {
				firstImageValue = JSON.stringify(firstImage).substring(0, 200);
			} else {
				firstImageValue = String(firstImage).substring(0, 200);
			}
		} catch (e) {
			firstImageValue = String(firstImage);
		}

		console.log(`[REPLICATE:${requestId}] Processing first image:`, {
			type: typeof firstImage,
			isString: typeof firstImage === 'string',
			hasUrl: typeof firstImage === 'object' && 'url' in firstImage,
			urlType: typeof firstImage === 'object' && firstImage !== null ? typeof firstImage.url : 'N/A',
			firstImageKeys: typeof firstImage === 'object' && firstImage !== null ? Object.keys(firstImage) : 'N/A',
			firstImageValue,
		});

		let imageUrl: string;
		if (typeof firstImage === 'string') {
			imageUrl = firstImage;
		} else if (typeof firstImage === 'object' && firstImage !== null) {
			// Handle different URL formats from Replicate
			if (typeof firstImage.url === 'string') {
				imageUrl = firstImage.url;
			} else if (typeof firstImage.url === 'function') {
				// URL might be a function that returns a Promise or string
				try {
					const urlResult = firstImage.url();
					// Check if it's a Promise-like object
					if (urlResult && typeof urlResult === 'object' && 'then' in urlResult) {
						imageUrl = await urlResult;
					} else {
						imageUrl = String(urlResult);
					}
				} catch (err) {
					console.error(`[REPLICATE:${requestId}] Error calling url():`, err);
					throw new Error('Failed to extract image URL from Replicate response');
				}
			} else if ('url' in firstImage && firstImage.url !== null && firstImage.url !== undefined) {
				// URL might be nested or another type
				imageUrl = String(firstImage.url);
			} else {
				// Try to stringify or get the first property
				imageUrl = String(firstImage);
			}
		} else {
			imageUrl = String(firstImage);
		}

		// Ensure imageUrl is actually a string
		if (typeof imageUrl !== 'string' || !imageUrl) {
			console.error(`[REPLICATE:${requestId}] No valid image URL found:`, {
				firstImage,
				imageUrl,
				imageUrlType: typeof imageUrl,
			});
			throw new Error('Replicate did not return a valid image URL');
		}

		console.log(`[REPLICATE:${requestId}] ✓ Image URL extracted:`, imageUrl.substring(0, 50) + '...');

		return {
			id: `replicate_${Date.now()}`,
			imageUrl,
			confidence: 0.95,
			metadata: {
				provider: 'replicate',
				model: 'seedream-4',
				operation: 'image_generation',
				prompt: request.prompt,
				aspectRatio: request.aspectRatio || 'match_input_image',
				quality: '4K',
				enhancedPrompt: true,
			},
		};
	}

	async swapModel(request: AIImageRequest): Promise<AIImageResponse> {
		// For Seedream 4, swap and generate are the same operation
		return this.generateImage(request);
	}

	async optimizeImage(request: AIImageRequest): Promise<AIImageResponse> {
		// Use generate for optimization as well
		return this.generateImage(request);
	}
}

// Factory for easy provider switching
export class AIProviderFactory {
	private static providers: Map<string, AIProvider> = new Map();

	static registerProvider(name: string, provider: AIProvider) {
		this.providers.set(name, provider);
	}

	static getProvider(name: string): AIProvider {
		const provider = this.providers.get(name);
		if (!provider) {
			throw new Error(
				`AI Provider '${name}' not found. Available providers: ${this.getAvailableProviders().join(', ')}`,
			);
		}
		return provider;
	}

	static getAvailableProviders(): string[] {
		return Array.from(this.providers.keys());
	}

	static hasProvider(name: string): boolean {
		return this.providers.has(name);
	}

	static clear() {
		this.providers.clear();
	}
}

// Initialize AI Providers - SERVER ONLY
// This function should only be called in server-side contexts
export const initializeAIProviders = (replicateToken: string, falKey?: string) => {
	if (typeof window !== 'undefined') {
		throw new Error('initializeAIProviders should only be called on the server');
	}

	// Register Replicate as primary provider
	const replicateProvider = new ReplicateProvider(replicateToken);
	AIProviderFactory.registerProvider('replicate', replicateProvider);

	// Register fal.ai as backup provider (if API key provided)
	if (falKey) {
		const falProvider = new FalAIProvider(falKey);
		AIProviderFactory.registerProvider('fal.ai', falProvider);
	}
};
