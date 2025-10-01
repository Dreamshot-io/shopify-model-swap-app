# A/B Testing for AI-Generated Product Images - PRP

**Product Requirements Document**  
**Version**: 1.0  
**Date**: January 2025  
**Author**: AI Product Team

## FEATURE:

I want the ability to generate A/B tests in Shopify's product page. This means the ability to consistently show different set of images 50/50 to check which ones have better conversion rate.

The existing extension at `/Users/javierjrueda/dev/shopify-model-swap-app/extensions/model-swap` allows merchants to generate AI-generated image variations. I want to extend this with the ability to assign images to Test A and Test B variants, then measure impressions/page views, ATC (Add to Cart), and revenue to calculate the difference in CVR (Conversion Rate) and choose the best image set.

## Executive Summary

Extend the existing Model Swap Shopify app with A/B testing capabilities to enable merchants to test different AI-generated image sets on their product pages. This feature will allow merchants to compare conversion rates between original and AI-generated images, or between different AI-generated image variations, to optimize their product page performance.

## Problem Statement

Currently, merchants using the Model Swap app can generate AI variations of product images but have no way to:

- Systematically test which images perform better
- Measure the impact of AI-generated images on conversion rates
- Make data-driven decisions about which image sets to use permanently
- Split traffic consistently to ensure reliable test results

## Goals & Objectives

### Primary Goals

1. **Enable A/B Testing**: Allow merchants to split product page traffic 50/50 between two image sets
2. **Measure Performance**: Track key metrics (impressions, CTR, ATC rate, revenue) for each variant
3. **Provide Insights**: Show statistical significance and recommend winning variants
4. **Maintain Consistency**: Ensure users see the same variant throughout their session

## User Stories

### Merchant (Admin)

- As a merchant, I want to create A/B tests comparing original vs AI-generated images
- As a merchant, I want to assign specific images to Test A and Test B variants
- As a merchant, I want to see real-time performance metrics for each variant
- As a merchant, I want to be notified when a test reaches statistical significance
- As a merchant, I want to easily apply the winning variant to my product permanently

### Customer (Storefront)

- As a customer, I want to see product images that are optimized for conversion
- As a customer, I want a consistent experience (same variant) throughout my session
- As a customer, I should not notice that I'm part of an A/B test

## Technical Requirements

### Architecture Overview

```
Shopify Product Page → App Proxy → A/B Test Engine → Image Variant Selection → Analytics Tracking
```

### Core Components

#### 1. A/B Test Management (Admin)

- **Location**: Extend existing `app/routes/app.ai-studio.tsx`
- **Features**:
  - Create/edit/delete A/B tests
  - Assign images to variants (A vs B)
  - Set test parameters (duration, traffic split)
  - View test results and analytics

#### 2. Storefront Integration

- **Method**: Shopify App Proxy + Theme modifications
- **Requirements**:
  - Seamless image replacement on product pages
  - Session consistency (same variant per user)
  - Minimal performance impact (<100ms latency)

#### 3. Analytics Engine

- **Tracking Events**:
  - Page impressions (variant shown)
  - Add to cart events
  - Purchase completion
  - Revenue attribution
- **Storage**: Extend existing `MetricEvent` model

#### 4. Statistical Analysis

- **Calculations**:
  - Conversion rate by variant
  - Statistical significance (95% confidence)
  - Confidence intervals
  - Required sample size estimation

### Data Models

#### A/B Test Model

```prisma
model ABTest {
  id            String    @id @default(cuid())
  shop          String
  productId     String
  name          String
  status        ABTestStatus @default(DRAFT)
  trafficSplit  Int       @default(50) // Percentage for variant A
  startDate     DateTime?
  endDate       DateTime?
  variantA      ABTestVariant[]
  variantB      ABTestVariant[]
  events        ABTestEvent[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model ABTestVariant {
  id        String   @id @default(cuid())
  testId    String
  variant   String   // "A" or "B"
  imageUrls String[] // JSON array of image URLs
  test      ABTest   @relation(fields: [testId], references: [id])
}

model ABTestEvent {
  id         String      @id @default(cuid())
  testId     String
  sessionId  String
  variant    String      // "A" or "B"
  eventType  ABTestEventType
  productId  String
  revenue    Decimal?
  createdAt  DateTime    @default(now())
  test       ABTest      @relation(fields: [testId], references: [id])
}

enum ABTestStatus {
  DRAFT
  RUNNING
  PAUSED
  COMPLETED
  ARCHIVED
}

enum ABTestEventType {
  IMPRESSION
  ADD_TO_CART
  PURCHASE
}
```

### API Endpoints

#### Admin API

```typescript
// Get all A/B tests for a shop
GET /api/ab-tests

// Create new A/B test
POST /api/ab-tests
{
  productId: string;
  name: string;
  variantA: { imageUrls: string[] };
  variantB: { imageUrls: string[] };
  trafficSplit?: number;
}

// Update A/B test
PUT /api/ab-tests/{id}

// Get test analytics
GET /api/ab-tests/{id}/analytics

// Start/stop test
POST /api/ab-tests/{id}/start
POST /api/ab-tests/{id}/stop
```

#### Storefront API (App Proxy)

```typescript
// Get variant for user session
GET /apps/model-swap/variant/{productId}?session={sessionId}
Response: {
  variant: "A" | "B";
  imageUrls: string[];
  testId: string;
}

// Track analytics event
POST /apps/model-swap/track
{
  testId: string;
  sessionId: string;
  eventType: "impression" | "add_to_cart" | "purchase";
  revenue?: number;
}
```

## User Experience Design

### Admin Interface

#### 1. A/B Test Creation Flow

1. **Select Product**: Choose product from existing AI Studio interface
2. **Configure Variants**:
   - Variant A: Select images (original or AI-generated)
   - Variant B: Select different images
3. **Test Settings**:
   - Test name
   - Traffic split (default 50/50)
   - Estimated duration
4. **Review & Launch**: Preview both variants, confirm settings

#### 2. Analytics Dashboard

- **Overview Cards**: Impressions, CTR, Conversion Rate, Revenue per variant
- **Statistical Significance**: Progress bar showing confidence level
- **Performance Chart**: Daily conversion rates over time
- **Recommendation**: Clear winner declaration when significant

#### 3. Test Management

- **Test List**: All tests with status, duration, performance summary
- **Quick Actions**: Start, pause, stop, archive tests
- **Bulk Operations**: Apply winning variant to product

## EXAMPLES:

### Current Extension Structure

The existing extension at `extensions/model-swap/` provides:

- **ProductDetailsConfigurationExtension.tsx**: Admin UI block that appears on product pages
- **Button Integration**: "🎨 Open AI Studio" button that navigates to the main app
- **GraphQL Integration**: Fetches product data and media from Shopify Admin API
- **Navigation**: Deep-links to AI Studio with product ID parameter

### A/B Test Extension Examples

The new A/B testing functionality will extend this structure with:

#### Admin Interface Extension

```typescript
// New component in AI Studio for A/B test management
<ABTestCreator
  productId={productId}
  availableImages={[originalImages, generatedImages]}
  onTestCreate={(test) => startABTest(test)}
/>
```

#### Storefront Integration Example

```javascript
// App proxy endpoint for variant selection
// GET /apps/model-swap/variant/gid://Product/123?session=abc123
{
  "variant": "A",
  "imageUrls": [
    "https://cdn.shopify.com/original-1.jpg",
    "https://cdn.shopify.com/original-2.jpg"
  ],
  "testId": "clu2x3y4z5"
}
```

#### Theme Integration Script

```javascript
// JavaScript snippet for theme integration
(function () {
  const productId = window.ShopifyAnalytics?.meta?.product?.gid;
  const sessionId = localStorage.getItem("ab_session") || generateSessionId();

  // Fetch variant for this user/product
  fetch(`/apps/model-swap/variant/${productId}?session=${sessionId}`)
    .then((response) => response.json())
    .then((data) => {
      if (data.variant && data.imageUrls) {
        replaceProductImages(data.imageUrls);
        trackImpression(data.testId, sessionId, data.variant);
      }
    });
})();
```

## DOCUMENTATION:

### Shopify Documentation Required

- [Shopify App Proxy](https://shopify.dev/docs/apps/online-store/app-proxies) - For storefront integration
- [Admin API GraphQL](https://shopify.dev/docs/api/admin-graphql) - For product and order data
- [UI Extensions](https://shopify.dev/docs/apps/app-extensions/ui-extensions) - For admin interface
- [Shopify Analytics](https://shopify.dev/docs/api/analytics) - For tracking events
- [Theme App Extensions](https://shopify.dev/docs/apps/online-store/theme-app-extensions) - Alternative storefront integration

### Statistical Analysis References

- [A/B Testing Statistical Significance](https://www.optimizely.com/optimization-glossary/statistical-significance/)
- [Sample Size Calculation](https://www.evanmiller.org/ab-testing/sample-size.html)
- [Confidence Intervals](https://en.wikipedia.org/wiki/Confidence_interval)

### Performance and Privacy

- [GDPR Compliance for A/B Testing](https://www.optimizely.com/optimization-glossary/gdpr-compliance/)
- [Web Performance Budgets](https://web.dev/performance-budgets-101/)
- [Shopify App Store Requirements](https://shopify.dev/docs/apps/store/requirements)

## OTHER CONSIDERATIONS:

### Session Consistency Gotchas

- **Browser Storage**: Use both localStorage and server-side session tracking for reliability
- **Cross-Device**: Consider how users switching devices affects test consistency
- **Cache Busting**: Ensure CDN and browser caches don't interfere with variant selection
- **Bot Traffic**: Filter out bot traffic from analytics to ensure accurate results

### Shopify-Specific Challenges

- **Theme Compatibility**: Different themes structure product images differently
- **App Proxy Limitations**: 5-second timeout, limited to specific paths
- **GraphQL Rate Limits**: Batch requests and cache data appropriately
- **Webhook Reliability**: Use idempotent event handling for purchase tracking

### Performance Considerations

- **Image Loading**: Preload both variants to avoid switching delays
- **Analytics Batching**: Batch tracking events to reduce server load
- **Database Indexing**: Index by shop, productId, and testId for fast queries
- **Memory Usage**: Clean up old test data and optimize data structures

### Statistical Accuracy

- **Sample Size**: Calculate minimum sample size before starting tests
- **Multiple Testing**: Adjust significance levels for multiple concurrent tests
- **Seasonal Effects**: Account for seasonal variation in conversion rates
- **Test Duration**: Ensure tests run long enough to account for weekly cycles

### Edge Cases

- **Product Updates**: Handle when product images change during active test
- **App Uninstall**: Clean up storefront modifications when app is removed
- **Test Conflicts**: Prevent overlapping tests on the same product
- **Revenue Attribution**: Handle complex scenarios like returns and exchanges

---

_This PRP serves as the foundation for implementing A/B testing functionality in the Model Swap Shopify app. Regular updates will be made as requirements evolve during development._
