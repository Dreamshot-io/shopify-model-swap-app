export type ABTestStatus =
  | "DRAFT"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED";

export type ABTestEventType = "IMPRESSION" | "ADD_TO_CART" | "PURCHASE";

export interface ABTestVariant {
  id: string;
  testId: string;
  variant: "A" | "B";
  imageUrls: string[];
}

export interface ABTestEvent {
  id: string;
  testId: string;
  sessionId: string;
  variant: "A" | "B";
  eventType: ABTestEventType;
  productId: string;
  revenue?: number;
  orderId?: string;
  createdAt: Date;
}

export interface ABTest {
  id: string;
  shop: string;
  productId: string;
  name: string;
  status: ABTestStatus;
  trafficSplit: number;
  startDate?: Date;
  endDate?: Date;
  variants: ABTestVariant[];
  events: ABTestEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ABTestVariantStats {
  impressions: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
  conversions: number; // backwards compatibility - same as addToCarts
  rate: number;
  ratePercent: string;
}

export interface ABTestStats {
  variantA: ABTestVariantStats;
  variantB: ABTestVariantStats;
  lift: string;
  confidence: string;
  isSignificant: boolean;
  winner: "A" | "B" | null;
  sampleSize: number;
}

export interface ABTestCreateRequest {
  name: string;
  productId: string;
  variantAImages: string[];
  variantBImages: string[];
  trafficSplit?: number;
}

export interface VariantResponse {
  variant: "A" | "B";
  imageUrls: string[];
  testId: string;
}

export interface TrackingEvent {
  testId: string;
  sessionId: string;
  eventType: ABTestEventType;
  productId: string;
  revenue?: number;
  orderId?: string;
}

// Serialized types for Remix loaders (Dates become strings after json() serialization)
export interface SerializedABTestEvent extends Omit<ABTestEvent, "createdAt"> {
  createdAt: string;
}

export interface SerializedABTest extends Omit<ABTest, "startDate" | "endDate" | "createdAt" | "updatedAt" | "variants" | "events"> {
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
  variants: ABTestVariant[];
  events: SerializedABTestEvent[];
}
