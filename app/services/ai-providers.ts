import { fal } from "@fal-ai/client";
// Domain-driven design for AI image generation services

export interface AIImageRequest {
  sourceImageUrl: string;
  prompt: string;
  productId: string;
  modelType?: "swap" | "generate" | "optimize";
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
  name = "fal.ai";
  private readonly modelPath = "fal-ai/gemini-25-flash-image/edit";

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
    const result = await fal.subscribe(this.modelPath, {
      input: {
        prompt: request.prompt,
        image_urls: [request.sourceImageUrl],
        output_format: "jpeg",
        num_images: 1,
      },
      logs: true,
      onQueueUpdate: (update: any) => {
        if (update?.status === "IN_PROGRESS" && Array.isArray(update?.logs)) {
          for (const log of update.logs) {
            // eslint-disable-next-line no-console
            console.log(`[fal.ai]`, log.message || log);
          }
        }
      },
    });

    const firstImageUrl = result?.data?.images?.[0]?.url as string;
    if (!firstImageUrl) {
      throw new Error("fal.ai did not return an image URL");
    }

    return {
      id: result.requestId || `fal_${Date.now()}`,
      imageUrl: firstImageUrl,
      confidence: 0.9,
      metadata: {
        provider: "fal.ai",
        operation: "image_edit",
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

// Factory for easy provider switching
export class AIProviderFactory {
  private static providers: Map<string, AIProvider> = new Map();

  static registerProvider(name: string, provider: AIProvider) {
    this.providers.set(name, provider);
  }

  static getProvider(name: string): AIProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`AI Provider '${name}' not found. Available providers: ${this.getAvailableProviders().join(', ')}`);
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

// Initialize with FAL.AI - SERVER ONLY
// This function should only be called in server-side contexts
export const initializeAIProviders = (falKey: string) => {
  if (typeof window !== 'undefined') {
    throw new Error('initializeAIProviders should only be called on the server');
  }
  
  const falProvider = new FalAIProvider(falKey);
  AIProviderFactory.registerProvider("fal.ai", falProvider);
};
