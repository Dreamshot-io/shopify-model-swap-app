export type ABTestStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export type ABTestEventType = 'IMPRESSION' | 'ADD_TO_CART' | 'PURCHASE';

export type ABTestScope = 'PRODUCT' | 'VARIANT';

export interface ABTestVariant {
	id: string;
	testId: string;
	variant: 'A' | 'B';
	imageUrls: string[];
	shopifyVariantId?: string | null;
}

export interface ABTestEvent {
	id: string;
	testId: string;
	sessionId: string;
	activeCase: 'BASE' | 'TEST';  // What was showing when event occurred
	variant?: 'A' | 'B';  // Optional for backward compatibility (A=BASE, B=TEST)
	eventType: ABTestEventType;
	productId: string;
	variantId?: string | null;
	revenue?: number;
	quantity?: number;
	orderId?: string;
	metadata?: any;
	createdAt: Date;
}

export interface ABTest {
	id: string;
	shop: string;
	productId: string;
	name: string;
	status: ABTestStatus;
	trafficSplit: number;
	variantScope?: string | null;
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
	winner: 'A' | 'B' | null;
	sampleSize: number;
}

export interface VariantTestConfig {
	shopifyVariantId: string;
	testImages: string[]; // User-provided test images (Variant B)
}

export interface ABTestCreateRequest {
	name: string;
	productId: string;
	variantScope?: ABTestScope;
	variantTests?: VariantTestConfig[];
	testImages?: string[]; // User-provided test images (Variant B) - control comes from snapshot
	trafficSplit?: number;
}

export interface VariantResponse {
	variant: 'A' | 'B';
	imageUrls: string[];
	testId: string;
}

export interface TrackingEvent {
	testId: string;
	sessionId: string;
	eventType: ABTestEventType;
	productId: string;
	variantId?: string;
	revenue?: number;
	orderId?: string;
}

// Serialized types for Remix loaders (Dates become strings after json() serialization)
export interface SerializedABTestEvent extends Omit<ABTestEvent, 'createdAt'> {
	createdAt: string;
	activeCase: 'BASE' | 'TEST';  // Ensure this is always present
	variant?: 'A' | 'B';  // Optional for backward compatibility
}

export interface SerializedABTest
	extends Omit<ABTest, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt' | 'variants' | 'events'> {
	startDate?: string | null;
	endDate?: string | null;
	createdAt: string;
	updatedAt: string;
	variants: ABTestVariant[];
	events: SerializedABTestEvent[];
}
