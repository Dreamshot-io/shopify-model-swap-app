// Types for the unified Product Hub

export interface ProductMedia {
  id: string;
  alt?: string;
  image?: {
    url: string;
    altText?: string;
    width?: number;
    height?: number;
  };
}

export interface ProductVariant {
  id: string;
  title: string;
  displayName?: string;
  sku?: string;
  selectedOptions?: Array<{
    name: string;
    value: string;
  }>;
  image?: {
    url: string;
    altText?: string;
  };
}

export interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  descriptionHtml?: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
  media?: {
    nodes: ProductMedia[];
  };
  variants?: {
    nodes: ProductVariant[];
  };
  metafield?: {
    value: string;
  };
}

export interface TestStatistics {
  base: {
    impressions: number;
    conversions: number;
    cvr: number;
    addToCarts?: number;
    revenue?: number;
  };
  test: {
    impressions: number;
    conversions: number;
    cvr: number;
    addToCarts?: number;
    revenue?: number;
  };
  lift: number;
}

export interface ABTestWithStats {
  id: string;
  name: string;
  productId: string;
  shopId: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  currentCase: 'BASE' | 'TEST';
  rotationHours: number;
  nextRotation?: string;
  baseImages: string | string[];
  testImages: string | string[];
  baseMediaIds?: string[];
  testMediaIds?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  statistics: TestStatistics;
  variants?: any[];
  rotationEvents?: any[];
}

export interface LibraryItem {
  imageUrl: string;
  sourceUrl?: string | null;
  variantIds?: string[];
}

export interface ProductStats {
  impressions: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
  cvr: number;
  atcRate: number;
}

export type TabType = 'home' | 'images' | 'tests';

export interface ProductHubData {
  product: Product;
  productId: string;
  shop: string;
  libraryItems: LibraryItem[];
  tests: ABTestWithStats[];
  activeTest: ABTestWithStats | null;
  draftTests: ABTestWithStats[];
  completedTests: ABTestWithStats[];
  productStats: ProductStats;
  currentTab: TabType;
}
