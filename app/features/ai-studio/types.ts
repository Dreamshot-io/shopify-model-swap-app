export type GeneratedImage = {
  id: string;
  imageUrl: string;
  confidence: number;
  metadata?: any;
};

export type DraftItem =
  | { imageUrl: string; sourceUrl?: string | null }
  | string;
