export type GeneratedImage = {
  id: string;
  imageUrl: string;
  confidence: number;
  metadata?: any;
};

export type DraftItem =
  | { imageUrl: string; sourceUrl?: string | null }
  | string;

// New Library type (replacing Draft terminology)
export type LibraryItem =
  | { imageUrl: string; sourceUrl?: string | null }
  | string;

// Batch processing types
export interface BatchProcessingState {
  isProcessing: boolean;
  currentIndex: number;
  totalImages: number;
  completedImages: GeneratedImage[];
  failedImages: Array<{ imageUrl: string; error: string }>;
}

export interface SelectedImage {
  id: string;
  url: string;
  altText?: string;
  isAIGenerated?: boolean;
}

export interface BatchGenerationResult {
  success: GeneratedImage[];
  failed: Array<{ sourceUrl: string; error: string }>;
}

// Action Response Types with strict typing for better error handling
export type ActionSuccessResponse<T = any> = {
  ok: true;
} & T;

export type ActionErrorResponse = {
  ok: false;
  error: string;
  debug?: any;
};

export type ActionResponse<T = any> = ActionSuccessResponse<T> | ActionErrorResponse;

// Specific action response types
export type GenerateImageResponse = ActionResponse<{
  result: GeneratedImage & { originalSource?: string };
  debug?: { r2Url: string; prompt: string };
}>;

export type PublishImageResponse = ActionResponse<{
  published: true;
}>;

export type LibraryActionResponse = ActionResponse<{
  savedToLibrary?: boolean;
  deletedFromLibrary?: boolean;
  deletedFromProduct?: boolean;
  duplicate?: boolean;
}>;

// Error boundary types for better error handling
export interface AIServiceError extends Error {
  code?: string;
  statusCode?: number;
  details?: Record<string, any>;
}

export interface NetworkError extends Error {
  status?: number;
  statusText?: string;
}
