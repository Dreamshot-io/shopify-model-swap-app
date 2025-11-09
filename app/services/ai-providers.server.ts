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
  try {
    // Validate request
    if (!request.sourceImageUrl) {
      throw new Error('Source image URL is required');
    }
    if (!request.prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }
    if (!request.productId) {
      throw new Error('Product ID is required');
    }

    // Ensure providers are initialized
    ensureAIProvidersInitialized();

    // Get AI provider (default to Replicate)
    const aiProvider = AIProviderFactory.getProvider("replicate");
    
    // Generate image based on model type
    let result: AIImageResponse;
    switch (request.modelType) {
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

    // Validate result
    if (!result.imageUrl) {
      throw new Error('AI provider did not return a valid image URL');
    }

    return result;
  } catch (error) {
    console.error('❌ AI image generation failed:', error);
    
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