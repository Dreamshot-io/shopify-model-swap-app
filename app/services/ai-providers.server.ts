import { AIProviderFactory, initializeAIProviders, type AIImageRequest, type AIImageResponse } from "./ai-providers";

/**
 * Server-only AI provider service
 * This module handles AI provider initialization and management on the server side only
 */

// Singleton pattern to ensure providers are initialized only once per server instance
let isInitialized = false;

/**
 * Initialize AI providers with environment variables
 * This should only be called on the server side
 */
export function ensureAIProvidersInitialized(): void {
  if (isInitialized) {
    return;
  }

  if (typeof window !== 'undefined') {
    throw new Error('AI providers should only be initialized on the server');
  }

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const falKey = process.env.FAL_KEY;

  if (!replicateToken) {
    throw new Error('REPLICATE_API_TOKEN environment variable is required but not set');
  }

  try {
    initializeAIProviders(replicateToken, falKey);
    isInitialized = true;
    console.log('✅ AI providers initialized successfully (Replicate primary, fal.ai backup)');
  } catch (error) {
    console.error('❌ Failed to initialize AI providers:', error);
    throw new Error(`Failed to initialize AI providers: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get an AI provider instance (server-side only)
 * Automatically ensures providers are initialized
 */
export function getAIProvider(name: string = "replicate") {
  ensureAIProvidersInitialized();
  return AIProviderFactory.getProvider(name);
}

/**
 * Generate an image using AI (server-side only)
 * Includes comprehensive error handling and validation
 */
export async function generateAIImage(request: AIImageRequest): Promise<AIImageResponse> {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[AI_PROVIDER:${requestId}] generateAIImage called`);

  try {
    // Validate request
    console.log(`[AI_PROVIDER:${requestId}] Validating request...`);
    if (!request.sourceImageUrl) {
      throw new Error('Source image URL is required');
    }
    if (!request.prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }
    if (!request.productId) {
      throw new Error('Product ID is required');
    }
    console.log(`[AI_PROVIDER:${requestId}] Validation passed:`, {
      sourceImageUrl: request.sourceImageUrl.substring(0, 50) + '...',
      prompt: request.prompt.substring(0, 50) + '...',
      productId: request.productId,
      modelType: request.modelType || 'swap',
      aspectRatio: request.aspectRatio,
    });

    // Ensure providers are initialized
    console.log(`[AI_PROVIDER:${requestId}] Ensuring providers initialized...`);
    ensureAIProvidersInitialized();
    console.log(`[AI_PROVIDER:${requestId}] Providers initialized`);

    // Get AI provider (default to Replicate)
    console.log(`[AI_PROVIDER:${requestId}] Getting provider: replicate`);
    const aiProvider = AIProviderFactory.getProvider("replicate");
    console.log(`[AI_PROVIDER:${requestId}] Provider obtained: ${aiProvider.name}`);

    // Generate image based on model type
    let result: AIImageResponse;
    const operation = request.modelType || "swap";
    console.log(`[AI_PROVIDER:${requestId}] Calling provider.${operation}...`);

    switch (operation) {
      case "generate":
        result = await aiProvider.generateImage(request);
        break;
      case "optimize":
        result = await aiProvider.optimizeImage(request);
        break;
      case "swap":
      default:
        result = await aiProvider.swapModel(request);
        break;
    }

    console.log(`[AI_PROVIDER:${requestId}] Provider call completed:`, {
      hasImageUrl: !!result.imageUrl,
      imageUrl: result.imageUrl ? result.imageUrl.substring(0, 50) + '...' : 'missing',
      id: result.id,
      confidence: result.confidence,
    });

    // Validate result
    if (!result.imageUrl) {
      console.error(`[AI_PROVIDER:${requestId}] Result validation failed: no imageUrl`);
      throw new Error('AI provider did not return a valid image URL');
    }

    console.log(`[AI_PROVIDER:${requestId}] ✓ Generation successful`);
    return result;
  } catch (error) {
    console.error(`[AI_PROVIDER:${requestId}] ❌ AI image generation failed:`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error,
    });

    // Re-throw with a standardized error structure
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown error occurred during AI image generation');
  }
}

/**
 * Check if AI providers are available and properly configured
 */
export function checkAIProviderHealth(): { healthy: boolean; error?: string } {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return { healthy: false, error: 'REPLICATE_API_TOKEN environment variable is not set' };
    }

    ensureAIProvidersInitialized();

    if (!AIProviderFactory.hasProvider("replicate")) {
      return { healthy: false, error: 'Replicate provider is not registered' };
    }

    return { healthy: true };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown health check error'
    };
  }
}
