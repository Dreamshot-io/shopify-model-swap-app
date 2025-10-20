# Product Requirements Document: A/B Testing Implementation v2.0

**Project:** Shopify Model Swap App - A/B Testing Feature
**Version:** 2.0 (Revised with 2025 Platform Updates)
**Date:** 2025-10-01
**Status:** Ready for Implementation
**Author:** Claude Code + Technical Review

---

## 🚨 CRITICAL UPDATES FROM v1.0

This is a **major revision** that addresses critical issues discovered during technical review:

1. **ScriptTag API is DEPRECATED** (Feb 2025) → Replaced with **Web Pixels API**
2. **Missing Security Layer** → Added `authenticate.public.appProxy`
3. **Incomplete File Upload** → Redesigned with 3-step staged upload
4. **Duplicate Code** → Identified and consolidated statistics utilities
5. **Missing Indexes** → Added database performance optimizations
6. **2x Timeline Increase** → Realistic estimates for production-quality implementation

**If you're reviewing v1.0, STOP and read this version instead.**

---

## Executive Summary

This PRD outlines a **production-ready** implementation plan for the A/B testing feature in the Shopify Model Swap App. The feature currently exists as a non-functional prototype that requires critical infrastructure, security improvements, and alignment with 2025 Shopify platform standards.

### Key Deliverables

1. ✅ **Modern tracking infrastructure** using Web Pixels API (not deprecated ScriptTag)
2. ✅ **Secure app proxy** with proper HMAC validation and authentication
3. ✅ **Real-time statistics** dashboard with actual event data (no mocks)
4. ✅ **Professional file upload** using Shopify's 3-step staged upload flow
5. ✅ **Privacy-compliant** tracking with GDPR/CCPA support
6. ✅ **Production-grade** error handling, monitoring, and performance optimization

### Success Metrics

- **Image replacement success rate**: >95% across tested themes
- **Tracking accuracy**: >99% of events captured
- **Performance impact**: <50ms additional page load time
- **Statistical confidence**: Accurate calculations with 95%+ threshold
- **Security**: Pass Shopify Partner review standards

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Critical Issues Identified](#critical-issues-identified)
3. [Current Architecture Analysis](#current-architecture-analysis)
4. [Solution Architecture](#solution-architecture)
5. [Implementation Phases](#implementation-phases)
6. [Technical Specifications](#technical-specifications)
7. [Testing Strategy](#testing-strategy)
8. [Risk Assessment](#risk-assessment)
9. [Success Criteria](#success-criteria)
10. [Future Enhancements](#future-enhancements)

---

## Problem Statement

### Current Situation

The A/B testing feature has been **partially implemented** with:

- ✅ Database schema (Prisma models for ABTest, ABTestVariant, ABTestEvent)
- ✅ Admin UI (test creation, management interfaces)
- ✅ Client-side tracking script (`public/ab-test-script.js`)
- ✅ API route handlers (variant assignment, event tracking)
- ✅ Statistics calculation utility (`app/features/ab-testing/utils/statistics.ts`)

### Why It Doesn't Work

#### 1. ❌ No App Proxy Configuration

- Routes like `/apps/model-swap/variant` exist in app but not exposed to storefront
- Missing configuration in `shopify.app.toml`
- **Impact**: Storefront cannot communicate with app backend

#### 2. ❌ No Tracking Deployment

- Tracking script exists but never loads on storefront
- No ScriptTag API integration (and ScriptTag is now deprecated!)
- No Web Pixels extension (modern alternative)
- **Impact**: Images never replaced, events never tracked

#### 3. ❌ Mock Statistics

- `ABTestManager` component uses `getMockStats()` with `Math.random()`
- Real events in database but not queried for display
- **Impact**: Users see fake data instead of real test performance

#### 4. ❌ Missing Security Layer

- App proxy routes don't use `authenticate.public.appProxy`
- No HMAC validation on storefront requests
- **Impact**: Vulnerable to request forgery and tampering

#### 5. ❌ No File Upload

- Users can only use AI-generated or existing product images
- No way to upload custom images
- **Impact**: Limited flexibility in test variants

---

## Critical Issues Identified

During technical review, we identified **7 critical issues** that would prevent successful deployment:

### 🔴 Issue #1: ScriptTag API is Deprecated (CRITICAL)

**Problem**: v1.0 PRD recommends ScriptTag API for MVP implementation.

**Reality**:

- ScriptTag blocked for new installs as of **February 1, 2025**
- ScriptTags on order status pages deprecated by August 2025/2026
- Shopify officially recommends: "Go with the new Web Pixels"

**Impact**:

- New app installs would be severely limited
- App Store rejection likely
- Future maintenance burden

**Solution**:

- Use **Web Pixels API** (modern, secure, privacy-compliant)
- Sandboxed execution environment
- Access to checkout and post-purchase pages
- Automatic privacy API compliance

**References**:

- https://shopify.dev/docs/apps/build/online-store/blocking-script-tags
- https://shopify.dev/docs/apps/build/marketing-analytics/pixels

---

### 🔴 Issue #2: Missing Security Authentication (CRITICAL)

**Problem**: App proxy routes don't implement Shopify's authentication layer.

**Current Code** (`apps.model-swap.variant.$productId.tsx`):

```typescript
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	// No authentication! ❌
	const url = new URL(request.url);
	const sessionId = url.searchParams.get('session');
	// ...
};
```

**Required Code**:

```typescript
import { authenticate } from '../shopify.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	// Proper authentication with HMAC validation ✅
	const { session, cors } = await authenticate.public.appProxy(request);

	// session provides shop context
	// cors provides proper headers
	// HMAC is automatically validated

	return json(data, {
		headers: cors.headers,
	});
};
```

**Impact**:

- Open to request forgery
- No shop context verification
- Potential data leakage

**Solution**: Implement `authenticate.public.appProxy` on all storefront-facing routes.

---

### 🟠 Issue #3: Hardcoded URLs (HIGH)

**Problem**: v1.0 PRD shows hardcoded cloudflare URL in configuration.

```toml
# ❌ WRONG - Hardcoded development URL
[app_proxy]
url = "https://heard-huge-fears-chairman.trycloudflare.com"
```

**Solution**: Use environment variable that's already configured.

```toml
# ✅ CORRECT - Dynamic from environment
[app_proxy]
url = "${SHOPIFY_APP_URL}"  # Already in shopify.server.ts
subpath = "model-swap"
prefix = "apps"
```

**Additional Consideration**: Document that prefix/subpath are **immutable** after first install.

---

### 🟠 Issue #4: Incomplete File Upload Design (HIGH)

**Problem**: v1.0 PRD shows simplified single-function upload.

**Reality**: Shopify Files API requires **3-step process**:

1. **Stage Upload** → Get temporary URL + parameters
2. **Upload File** → POST to URL with auth parameters
3. **Create Asset** → Finalize file in Shopify system
4. **(Bonus) Poll** → Wait for async processing

**Example Complexity**:

```typescript
// Step 1: Create staged upload target
const stagedUpload = await admin.graphql(
	`
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
    }
  }
`,
	{
		variables: {
			input: [
				{
					filename: file.name,
					mimeType: file.type,
					resource: 'PRODUCT_IMAGE',
					fileSize: file.size.toString(),
					httpMethod: 'POST',
				},
			],
		},
	},
);

// Step 2: Upload to staged URL with FormData
const formData = new FormData();
stagedTarget.parameters.forEach(param => {
	formData.append(param.name, param.value);
});
formData.append('file', file);

await fetch(stagedTarget.url, {
	method: 'POST',
	body: formData,
});

// Step 3: Create file asset
const fileCreate = await admin.graphql(
	`
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id ... on MediaImage { image { url } } }
    }
  }
`,
	{
		variables: {
			files: [
				{
					originalSource: stagedTarget.resourceUrl,
					contentType: 'IMAGE',
				},
			],
		},
	},
);

// Step 4: Poll for processing (files processed async)
const finalFile = await pollUntilReady(fileCreate.files[0].id);
```

**Impact**:

- v1.0 implementation would fail
- Missing error handling for async processing
- No progress indication to user

**Solution**: Implement full staged upload flow with retry logic.

---

### 🟡 Issue #5: Duplicate Statistics Code (MEDIUM)

**Problem**: Statistics calculation exists in **two places**:

1. **✅ Proper utility**: `app/features/ab-testing/utils/statistics.ts`
    - Clean, tested, reusable
    - Has calculateStatistics() function
    - Has calculateSampleSizeNeeded() helper

2. **❌ Duplicate**: `app/routes/app.ab-tests.$id.tsx` lines 51-121
    - Same calculation logic
    - Not reusable
    - Violates DRY principle

**Solution**: Remove duplicate, use shared utility everywhere.

---

### 🟡 Issue #6: Missing Database Indexes (MEDIUM)

**Problem**: Database schema lacks performance indexes.

**Current Schema** (`prisma/schema.prisma`):

```prisma
model ABTest {
  id            String        @id @default(cuid())
  shop          String        // ❌ No index!
  productId     String        // ❌ No index!
  status        ABTestStatus  @default(DRAFT)  // ❌ No index!
  // ...
}

model ABTestEvent {
  id         String          @id @default(cuid())
  testId     String          // ❌ No composite index!
  sessionId  String          // ❌ No composite index!
  eventType  ABTestEventType
  // ...
}
```

**Impact**:

- Slow queries as data grows
- Full table scans on common filters
- Poor performance at scale

**Solution**: Add strategic indexes:

```prisma
model ABTest {
  // ...
  @@index([shop, status])
  @@index([shop, productId])
  @@index([status, startDate])
}

model ABTestEvent {
  // ...
  @@index([testId, sessionId])
  @@index([testId, eventType])
  @@index([testId, createdAt])
}

model ABTestVariant {
  // ...
  @@index([testId, variant])
}
```

---

### 🟡 Issue #7: Theme Compatibility Not Addressed (MEDIUM)

**Problem**: Assumption that image replacement "just works" on all themes.

**Research Finding**:

> "The media block is really baked into the template on all of the default Shopify themes and can't be disabled or replaced by the block from theme app extension"
> — Shopify Community Discussion

**Reality**:

- Product media gallery structure varies by theme
- Vintage themes use different selectors
- Some themes lazy-load images
- Image replacement may fail on certain themes

**Impact**:

- Feature may not work on some popular themes
- Customer complaints
- Refund requests

**Solution**:

- Comprehensive theme compatibility testing (Phase 4)
- Multiple selector strategies in tracking script
- Fallback mechanisms
- Clear compatibility documentation for merchants

---

## Current Architecture Analysis

### What EXISTS and WORKS ✅

#### 1. Database Schema (Complete)

**File**: `prisma/schema.prisma`

```prisma
model ABTest {
  id            String        @id @default(cuid())
  shop          String
  productId     String
  name          String
  status        ABTestStatus  @default(DRAFT)
  trafficSplit  Int           @default(50)
  startDate     DateTime?
  endDate       DateTime?
  variants      ABTestVariant[]
  events        ABTestEvent[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model ABTestVariant {
  id        String   @id @default(cuid())
  testId    String
  variant   String   // "A" or "B"
  imageUrls String   // JSON array stored as string
  test      ABTest   @relation(fields: [testId], references: [id])
}

model ABTestEvent {
  id         String          @id @default(cuid())
  testId     String
  sessionId  String
  variant    String          // "A" or "B"
  eventType  ABTestEventType // IMPRESSION, ADD_TO_CART, PURCHASE
  productId  String
  revenue    Decimal?
  createdAt  DateTime        @default(now())
  test       ABTest          @relation(fields: [testId], references: [id])
}
```

**Status**: ✅ Schema is well-designed and supports all required features.

**Needs**: Add indexes for performance (see Issue #6).

---

#### 2. Statistics Utility (Complete)

**File**: `app/features/ab-testing/utils/statistics.ts`

Contains proper implementation of:

- ✅ `calculateStatistics()` - compute CVR, lift, confidence
- ✅ Z-test for statistical significance
- ✅ Normal CDF approximation (Abramowitz and Stegun)
- ✅ `calculateSampleSizeNeeded()` - power analysis
- ✅ Proper TypeScript types

**Status**: ✅ Well-implemented, just needs to be used!

**Action**: Wire this into `ABTestManager` component (currently uses mocks).

---

#### 3. Admin UI (Functional)

**Files**:

- `app/routes/app.ab-tests.tsx` - Test management page
- `app/routes/app.ab-tests.$id.tsx` - Test details page
- `app/features/ab-testing/components/ABTestManager.tsx` - Main manager component
- `app/features/ab-testing/components/ABTestCreator.tsx` - Test creation form
- `app/features/ab-testing/components/ABTestCard.tsx` - Test display card
- `app/features/ab-testing/components/ABTestSummary.tsx` - Summary stats

**Capabilities**:

- Create A/B tests with name, product ID, variant images
- Start/stop/delete tests
- View statistics (currently mocked)
- Traffic split configuration
- Integrated into AI Studio page

**Issues**:

- Statistics use `getMockStats()` function (lines 55-79 in ABTestManager.tsx)
- Need to replace with real data from `calculateStatistics()` utility

---

#### 4. API Routes (Exist but Incomplete)

**File**: `app/routes/apps.model-swap.variant.$productId.tsx`

- **Purpose**: Assign variant to user session, return images
- **Logic**: ✅ Complete (variant assignment, traffic split)
- **Issues**: ❌ No authentication, no CORS, not accessible from storefront

**File**: `app/routes/apps.model-swap.track.tsx`

- **Purpose**: Track events (impression, add-to-cart, purchase)
- **Logic**: ✅ Complete (event creation, duplicate prevention)
- **Issues**: ❌ No authentication, no CORS, not accessible from storefront

**What's Missing**:

1. `authenticate.public.appProxy(request)` call
2. App proxy configuration in `shopify.app.toml`
3. Proper CORS headers from Shopify's auth

---

#### 5. Tracking Script (Complete but Not Deployed)

**File**: `public/ab-test-script.js`

**Capabilities**:

- ✅ Session ID management (localStorage)
- ✅ Product ID detection (multiple methods)
- ✅ Variant fetching from app proxy
- ✅ Image replacement (multiple selectors for theme compatibility)
- ✅ Event tracking (impression, add-to-cart, purchase)
- ✅ Thank-you page purchase tracking

**Status**: ✅ Script is well-written and comprehensive.

**Issue**: Never loaded on storefront! Need deployment mechanism.

---

### What's MISSING ❌

#### 1. App Proxy Configuration ❌ CRITICAL

- No configuration in `shopify.app.toml`
- Routes not exposed to storefront domain
- **Without this, nothing works**

#### 2. Web Pixels Extension ❌ CRITICAL

- No modern tracking deployment
- Relying on deprecated ScriptTag approach
- Missing privacy compliance

#### 3. Security Authentication ❌ CRITICAL

- No `authenticate.public.appProxy` usage
- No HMAC validation
- Security vulnerability

#### 4. File Upload System ❌

- No upload routes
- No staged upload implementation
- No storage service

#### 5. Database Indexes ❌

- Performance issues at scale
- Slow queries on common filters

---

## Solution Architecture

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shopify Storefront                           │
│                 (mystore.myshopify.com)                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Product Page                                            │  │
│  │                                                          │  │
│  │  1. Web Pixels Extension loads (sandboxed)             │  │
│  │  2. Subscribes to page_viewed event                     │  │
│  │  3. Detects product page                                │  │
│  │  4. Fetches variant via App Proxy                       │  │
│  │     → /apps/model-swap/variant/{pid}?session={sid}     │  │
│  │  5. Replaces images with variant images                 │  │
│  │  6. Tracks impression event                             │  │
│  │  7. Subscribes to product_added_to_cart                 │  │
│  │  8. Tracks conversion events                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           │ App Proxy (with HMAC validation)    │
│                           ▼                                     │
│           /apps/model-swap/* → Remix App                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              Remix App (Shopify App Backend)                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  App Proxy Routes (Public, HMAC-validated)              │  │
│  │                                                          │  │
│  │  • /apps/model-swap.variant.$productId                  │  │
│  │    ├─ authenticate.public.appProxy(request) ✅          │  │
│  │    ├─ Check for active test                             │  │
│  │    ├─ Assign variant (traffic split)                    │  │
│  │    ├─ Track impression event                            │  │
│  │    └─ Return variant + images                           │  │
│  │                                                          │  │
│  │  • /apps/model-swap.track                               │  │
│  │    ├─ authenticate.public.appProxy(request) ✅          │  │
│  │    ├─ Validate event data                               │  │
│  │    ├─ Check duplicate prevention                        │  │
│  │    └─ Store in ABTestEvent table                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Admin Routes (Embedded, OAuth-authenticated)           │  │
│  │                                                          │  │
│  │  • /app/ab-tests                                        │  │
│  │    ├─ authenticate.admin(request) ✅                    │  │
│  │    ├─ List all tests for shop                           │  │
│  │    └─ Display with real statistics                      │  │
│  │                                                          │  │
│  │  • /app/ai-studio                                       │  │
│  │    ├─ Generate AI images                                │  │
│  │    ├─ Upload custom images (3-step staged upload)       │  │
│  │    └─ Create A/B tests from library                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Database (Prisma + SQLite)                              │  │
│  │  • ABTest (with indexes on shop, status, productId)     │  │
│  │  • ABTestVariant (with index on testId, variant)        │  │
│  │  • ABTestEvent (with indexes on testId+sessionId)       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Extensions                                              │  │
│  │  • Web Pixels Extension (ab-test-pixel)                 │  │
│  │    └─ Sandboxed tracking in web worker                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architecture Decisions

#### Decision 1: Web Pixels vs ScriptTag

**Choice**: Web Pixels API
**Reasoning**:

- ✅ ScriptTag deprecated as of Feb 2025
- ✅ Better security (sandboxed execution)
- ✅ Privacy API compliant (GDPR/CCPA)
- ✅ Access to checkout pages
- ✅ Future-proof

#### Decision 2: App Proxy for Storefront Access

**Choice**: Shopify App Proxy with HMAC validation
**Reasoning**:

- ✅ Official Shopify pattern for storefront-to-app communication
- ✅ Built-in request validation
- ✅ No CORS issues
- ✅ Shop context provided automatically

#### Decision 3: Client-Side Image Replacement

**Choice**: JavaScript-based DOM manipulation
**Reasoning**:

- ✅ Works with existing themes (no theme editing)
- ✅ Instant visual feedback
- ✅ No server-side rendering complexity
- ⚠️ Theme compatibility requires testing

#### Decision 4: Statistics on Demand

**Choice**: Calculate statistics from events at request time
**Reasoning**:

- ✅ Always current data
- ✅ Simple implementation
- ✅ No background jobs needed
- ⚠️ Can optimize with caching later if needed

---

## Implementation Phases

### Phase 0: Foundation & Security (NEW)

**Duration**: 2-3 hours
**Priority**: CRITICAL - Must complete before Phase 1

#### 0.1 Update Database Schema

**Task**: Add performance indexes

**File**: `prisma/schema.prisma`

**Changes**:

```prisma
model ABTest {
  id            String        @id @default(cuid())
  shop          String
  productId     String
  name          String
  status        ABTestStatus  @default(DRAFT)
  trafficSplit  Int           @default(50)
  startDate     DateTime?
  endDate       DateTime?
  variants      ABTestVariant[]
  events        ABTestEvent[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  // NEW: Performance indexes
  @@index([shop, status])
  @@index([shop, productId])
  @@index([status, startDate])
}

model ABTestEvent {
  id         String          @id @default(cuid())
  testId     String
  sessionId  String
  variant    String
  eventType  ABTestEventType
  productId  String
  revenue    Decimal?
  createdAt  DateTime        @default(now())
  test       ABTest          @relation(fields: [testId], references: [id], onDelete: Cascade)

  // NEW: Performance indexes
  @@index([testId, sessionId])
  @@index([testId, eventType])
  @@index([testId, createdAt])
}

model ABTestVariant {
  id        String   @id @default(cuid())
  testId    String
  variant   String
  imageUrls String
  test      ABTest   @relation(fields: [testId], references: [id], onDelete: Cascade)

  // NEW: Performance index
  @@index([testId, variant])
}
```

**Migration**:

```bash
npx prisma migrate dev --name add_ab_test_indexes
```

**Verification**:

- Run migration successfully
- Check database for new indexes
- Test query performance

**Estimated Time**: 30 minutes

---

#### 0.2 Implement App Proxy Authentication

**Task**: Add security layer to storefront routes

**Files to Update**:

1. `app/routes/apps.model-swap.variant.$productId.tsx`
2. `app/routes/apps.model-swap.track.tsx`

**Changes for `apps.model-swap.variant.$productId.tsx`**:

```typescript
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server'; // ADD THIS
import db from '../db.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	// ADD: Proper authentication with HMAC validation
	try {
		const { session, cors } = await authenticate.public.appProxy(request);
		// session contains: { shop, accessToken, ... }
		// cors contains: { headers } for proper CORS

		const url = new URL(request.url);
		const sessionId = url.searchParams.get('session');
		const productId = params.productId;

		if (!sessionId || !productId) {
			return json({ error: 'Missing session or productId' }, { status: 400, headers: cors.headers });
		}

		// Find active A/B test for this product and shop
		const activeTest = await db.aBTest.findFirst({
			where: {
				productId,
				shop: session?.shop, // ADD: Filter by shop
				status: 'RUNNING',
			},
			include: {
				variants: true,
			},
		});

		if (!activeTest || activeTest.variants.length !== 2) {
			return json({ variant: null }, { headers: cors.headers });
		}

		// ... rest of existing logic ...

		return json(
			{
				variant: selectedVariant,
				imageUrls,
				testId: activeTest.id,
			},
			{
				headers: cors.headers, // ADD: Use Shopify's CORS headers
			},
		);
	} catch (error) {
		console.error('Error in variant endpoint:', error);
		return json({ error: 'Authentication failed' }, { status: 401 });
	}
};
```

**Changes for `apps.model-swap.track.tsx`**:

```typescript
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server'; // ADD THIS
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
	if (request.method !== 'POST') {
		return json({ error: 'Method not allowed' }, { status: 405 });
	}

	try {
		// ADD: Proper authentication
		const { session, cors } = await authenticate.public.appProxy(request);

		const body = await request.json();
		const { testId, sessionId, eventType, revenue, productId } = body;

		if (!testId || !sessionId || !eventType || !productId) {
			return json({ error: 'Missing required fields' }, { status: 400, headers: cors.headers });
		}

		// Validate event type
		const validEventTypes = ['IMPRESSION', 'ADD_TO_CART', 'PURCHASE'];
		if (!validEventTypes.includes(eventType)) {
			return json({ error: 'Invalid event type' }, { status: 400, headers: cors.headers });
		}

		// ADD: Verify test belongs to this shop
		const test = await db.aBTest.findFirst({
			where: {
				id: testId,
				shop: session?.shop,
			},
		});

		if (!test) {
			return json({ error: 'Test not found or unauthorized' }, { status: 404, headers: cors.headers });
		}

		// ... rest of existing logic ...

		return json({ success: true }, { headers: cors.headers });
	} catch (error) {
		console.error('Error tracking A/B test event:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
```

**Estimated Time**: 1 hour

---

#### 0.3 Configure App Proxy

**Task**: Add app proxy configuration with proper URL

**File**: `shopify.app.toml`

**Changes**:

```toml
# Learn more about configuring your app at https://shopify.dev/docs/apps/tools/cli/configuration

client_id = "a37f0ea132844ccc3c8e104205da4c41"
name = "dreamshot-model-swap"
application_url = "https://heard-huge-fears-chairman.trycloudflare.com"
embedded = true
handle = "dreamshot-model-swap"

[build]
include_config_on_deploy = true
automatically_update_urls_on_dev = true

# NEW: App Proxy Configuration
[app_proxy]
url = "${SHOPIFY_APP_URL}"  # Uses environment variable
subpath = "model-swap"
prefix = "apps"

# IMPORTANT: Once deployed, prefix and subpath are IMMUTABLE per store
# Changing these requires merchants to reinstall the app

[webhooks]
api_version = "2025-07"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

  [[webhooks.subscriptions]]
  topics = [ "app_subscriptions/update" ]
  uri = "/webhooks/app/subscriptions_update"

[access_scopes]
scopes = "write_products"

[auth]
redirect_urls = [
  "https://heard-huge-fears-chairman.trycloudflare.com/auth/callback",
  "https://heard-huge-fears-chairman.trycloudflare.com/auth/shopify/callback",
  "https://heard-huge-fears-chairman.trycloudflare.com/api/auth/callback"
]

[pos]
embedded = false
```

**Deploy**:

```bash
bun run deploy
```

**Verification**:

1. Check Shopify Partners dashboard
2. Verify app proxy appears in configuration
3. Test proxy route: `{shop-domain}/apps/model-swap/health` (create simple health check)

**Estimated Time**: 30 minutes

---

#### 0.4 Create Health Check Endpoint

**Task**: Create simple endpoint to verify app proxy works

**New File**: `app/routes/apps.model-swap.health.tsx`

```typescript
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
	try {
		const { session, cors } = await authenticate.public.appProxy(request);

		return json(
			{
				status: 'healthy',
				shop: session?.shop,
				timestamp: new Date().toISOString(),
				proxy: 'working',
			},
			{
				headers: cors.headers,
			},
		);
	} catch (error) {
		return json(
			{
				status: 'error',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			{
				status: 500,
			},
		);
	}
};
```

**Test**:

```bash
# Visit in browser:
https://your-dev-store.myshopify.com/apps/model-swap/health

# Should return:
{
  "status": "healthy",
  "shop": "your-dev-store.myshopify.com",
  "timestamp": "2025-10-01T12:00:00Z",
  "proxy": "working"
}
```

**Estimated Time**: 15 minutes

---

#### 0.5 Documentation

**Task**: Document environment variables and security considerations

**New File**: `docs/APP_PROXY_SETUP.md`

```markdown
# App Proxy Setup & Security

## Environment Variables Required

- `SHOPIFY_APP_URL` - Public URL of your app (already configured)
- Used in `shopify.app.toml` for app proxy configuration

## App Proxy Routes

All routes under `apps.model-swap.*` are accessible from storefront via:

https://{shop-domain}/apps/model-swap/{route}

Example:

- `apps.model-swap.variant.$productId.tsx` → `/apps/model-swap/variant/gid:...`
- `apps.model-swap.track.tsx` → `/apps/model-swap/track`
- `apps.model-swap.health.tsx` → `/apps/model-swap/health`

## Security

All app proxy routes MUST use:

typescript
const { session, cors } = await authenticate.public.appProxy(request);

This provides:

- **HMAC validation** - Verifies request came from Shopify
- **Shop context** - `session.shop` identifies the merchant
- **CORS headers** - `cors.headers` for cross-domain requests
- **Timestamp validation** - Prevents replay attacks (90s window)

## Important Notes

1. **Immutable Configuration**: After first install, `prefix` and `subpath` cannot change
2. **No Redirects**: App proxy routes cannot redirect (Shopify limitation)
3. **Query Params**: Shopify adds `shop`, `path_prefix`, `timestamp`, `signature`
4. **Max URL Length**: 2048 characters
5. **Timeout**: Shopify enforces 5-second timeout

## Testing

bash

# Test health check

curl "https://your-dev-store.myshopify.com/apps/model-swap/health"

# Test variant endpoint (requires active test)

curl "https://your-dev-store.myshopify.com/apps/model-swap/variant/gid:...?session=test123"
```

**Estimated Time**: 15 minutes

---

**Phase 0 Total Estimated Time**: 2-3 hours

---

### Phase 1: Modern Tracking Implementation (REVISED)

**Duration**: 6-8 hours
**Priority**: HIGH

#### 1.1 Create Web Pixels Extension

**Task**: Replace deprecated ScriptTag with modern Web Pixels

**Generate Extension**:

```bash
bun run shopify app generate extension

# Select: Web pixel
# Name: ab-test-pixel
```

**Structure Created**:

```
extensions/ab-test-pixel/
├── shopify.extension.toml
├── package.json
└── src/
    └── index.ts
```

**Implementation** (`extensions/ab-test-pixel/src/index.ts`):

```typescript
import { register } from '@shopify/web-pixels-extension';

interface ABTestData {
	testId: string;
	variant: string;
	productId: string;
}

register(({ analytics, browser, settings }) => {
	const APP_PROXY_BASE = '/apps/model-swap';
	const SESSION_STORAGE_KEY = 'ab_test_session';

	// Utility: Generate session ID
	function generateSessionId(): string {
		const random = Math.random().toString(36).substr(2, 16);
		const timestamp = Date.now().toString(36);
		return `session_${random}${timestamp}`;
	}

	// Utility: Get or create session ID
	function getSessionId(): string {
		let sessionId = browser.localStorage.getItem(SESSION_STORAGE_KEY);
		if (!sessionId) {
			sessionId = generateSessionId();
			browser.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		}
		return sessionId;
	}

	// Utility: Track event to backend
	async function trackEvent(testId: string, eventType: string, productId: string, revenue?: number): Promise<void> {
		const sessionId = getSessionId();

		try {
			await fetch(`${APP_PROXY_BASE}/track`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					testId,
					sessionId,
					eventType,
					productId,
					revenue,
				}),
			});
		} catch (error) {
			console.error('[A/B Test] Failed to track event:', error);
		}
	}

	// Utility: Fetch variant for product
	async function fetchVariant(productId: string): Promise<{
		variant: string | null;
		imageUrls?: string[];
		testId?: string;
	} | null> {
		const sessionId = getSessionId();

		try {
			const response = await fetch(
				`${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`,
			);
			return await response.json();
		} catch (error) {
			console.error('[A/B Test] Failed to fetch variant:', error);
			return null;
		}
	}

	// Utility: Replace product images
	function replaceProductImages(imageUrls: string[]): boolean {
		const selectors = [
			'.product__media img',
			'.product-single__photo img',
			'.product-image img',
			'.product-photos img',
			'[data-product-image]',
			'.product__photo img',
			'.product-gallery img',
			'.product-slider img',
		];

		let imagesReplaced = 0;

		selectors.forEach(selector => {
			const images = document.querySelectorAll(selector);
			images.forEach((img: Element, index: number) => {
				if (index < imageUrls.length && img instanceof HTMLImageElement) {
					// Store original
					if (!img.dataset.originalSrc) {
						img.dataset.originalSrc = img.src;
					}
					// Replace with variant
					img.src = imageUrls[index];
					img.srcset = ''; // Clear srcset
					imagesReplaced++;
				}
			});
		});

		return imagesReplaced > 0;
	}

	// Handle product page views
	analytics.subscribe('page_viewed', async event => {
		// Check if we're on a product page
		const isProductPage = event.context.document.location.pathname.includes('/products/');

		if (!isProductPage) {
			return;
		}

		// Extract product ID from event
		const productId = event.data?.product?.id;

		if (!productId) {
			console.log('[A/B Test] No product ID found');
			return;
		}

		// Fetch variant assignment
		const variantData = await fetchVariant(productId);

		if (!variantData || !variantData.variant || !variantData.imageUrls || !variantData.testId) {
			console.log('[A/B Test] No active test for this product');
			return;
		}

		console.log(`[A/B Test] Running test ${variantData.testId}, variant ${variantData.variant}`);

		// Replace images
		const success = replaceProductImages(variantData.imageUrls);

		if (success) {
			// Note: Impression is already tracked by the variant endpoint
			// Store test info for conversion tracking
			browser.sessionStorage.setItem(
				'ab_test_active',
				JSON.stringify({
					testId: variantData.testId,
					variant: variantData.variant,
					productId: productId,
				}),
			);
		}
	});

	// Handle add to cart events
	analytics.subscribe('product_added_to_cart', async event => {
		const testDataStr = browser.sessionStorage.getItem('ab_test_active');

		if (!testDataStr) {
			return;
		}

		try {
			const testData: ABTestData = JSON.parse(testDataStr);
			await trackEvent(testData.testId, 'ADD_TO_CART', testData.productId);
		} catch (error) {
			console.error('[A/B Test] Error tracking add to cart:', error);
		}
	});

	// Handle checkout completion
	analytics.subscribe('checkout_completed', async event => {
		const testDataStr = browser.sessionStorage.getItem('ab_test_active');

		if (!testDataStr) {
			return;
		}

		try {
			const testData: ABTestData = JSON.parse(testDataStr);
			const revenue = event.data?.checkout?.totalPrice?.amount;

			await trackEvent(
				testData.testId,
				'PURCHASE',
				testData.productId,
				revenue ? parseFloat(revenue) : undefined,
			);

			// Clean up
			browser.sessionStorage.removeItem('ab_test_active');
		} catch (error) {
			console.error('[A/B Test] Error tracking purchase:', error);
		}
	});
});
```

**Configuration** (`extensions/ab-test-pixel/shopify.extension.toml`):

```toml
api_version = "2025-07"

[[extensions]]
name = "ab-test-pixel"
handle = "ab-test-pixel"
type = "web_pixel_extension"

[extensions.settings]
  [[extensions.settings.fields]]
  key = "enabled"
  type = "boolean"
  name = "Enable A/B Testing"
  description = "Enable A/B testing tracking on your storefront"

  [[extensions.settings.fields]]
  key = "debug"
  type = "boolean"
  name = "Debug Mode"
  description = "Enable console logging for debugging"
```

**Deploy**:

```bash
bun run deploy
```

**Verification**:

1. Install extension in development store
2. Visit product page
3. Check browser console for A/B test logs
4. Verify events in database

**Estimated Time**: 3 hours

---

#### 1.2 Hybrid Approach for Image Replacement

**Task**: Support themes where Web Pixels can't manipulate DOM

**Rationale**: Web Pixels run in sandboxed workers, which limits DOM access. For image replacement, we need a lightweight script that runs in main thread.

**Solution**: Serve a minimal script via app proxy that ONLY handles image replacement (not tracking).

**New File**: `public/image-replacer.js`

```javascript
(function () {
	'use strict';

	const APP_PROXY_BASE = '/apps/model-swap';
	const SESSION_STORAGE_KEY = 'ab_test_session';

	function getSessionId() {
		let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
		if (!sessionId) {
			sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
			localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		}
		return sessionId;
	}

	function getProductId() {
		if (window.ShopifyAnalytics?.meta?.product?.gid) {
			return window.ShopifyAnalytics.meta.product.gid;
		}

		const productForm = document.querySelector('form[action*="/cart/add"]');
		if (productForm) {
			const productIdInput = productForm.querySelector('input[name="id"]');
			if (productIdInput) {
				return 'gid://shopify/Product/' + productIdInput.value;
			}
		}

		return null;
	}

	function replaceImages(imageUrls) {
		const selectors = [
			'.product__media img',
			'.product-single__photo img',
			'.product-image img',
			'.product-photos img',
			'[data-product-image]',
			'.product__photo img',
		];

		let replaced = 0;
		selectors.forEach(selector => {
			const images = document.querySelectorAll(selector);
			images.forEach((img, index) => {
				if (index < imageUrls.length) {
					if (!img.dataset.originalSrc) {
						img.dataset.originalSrc = img.src;
					}
					img.src = imageUrls[index];
					img.srcset = '';
					replaced++;
				}
			});
		});

		return replaced > 0;
	}

	async function init() {
		const productId = getProductId();
		if (!productId) return;

		const sessionId = getSessionId();

		try {
			const response = await fetch(
				`${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`,
			);
			const data = await response.json();

			if (data.variant && data.imageUrls) {
				const success = replaceImages(data.imageUrls);
				if (success) {
					sessionStorage.setItem(
						'ab_test_active',
						JSON.stringify({
							testId: data.testId,
							variant: data.variant,
							productId: productId,
						}),
					);
				}
			}
		} catch (error) {
			console.error('[A/B Test] Image replacement failed:', error);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
```

**Serve Script**:

**New File**: `app/routes/apps.model-swap.script.tsx`

```typescript
import type { LoaderFunctionArgs } from '@remix-run/node';
import { readFileSync } from 'fs';
import { join } from 'path';

export const loader = async ({ request }: LoaderFunctionArgs) => {
	// Note: No authentication needed for public script
	// But we do validate it's coming from a Shopify domain

	const scriptPath = join(process.cwd(), 'public', 'image-replacer.js');
	const script = readFileSync(scriptPath, 'utf-8');

	return new Response(script, {
		headers: {
			'Content-Type': 'application/javascript',
			'Cache-Control': 'public, max-age=300', // 5 min cache
			'Access-Control-Allow-Origin': '*',
		},
	});
};
```

**Usage**: Merchants can optionally add to their theme:

```html
<script src="/apps/model-swap/script" async></script>
```

**Estimated Time**: 1.5 hours

---

#### 1.3 Update ABTestManager to Use Real Statistics

**Task**: Replace mock data with real calculations

**File**: `app/features/ab-testing/components/ABTestManager.tsx`

**Changes**:

```typescript
// At top of file, add import:
import { calculateStatistics } from '../utils/statistics';

// REMOVE getMockStats function (lines 55-79)

// REPLACE usage (line 233):
// OLD:
const stats = getMockStats(test);

// NEW:
const stats = calculateStatistics(test.events);
```

**Full Replacement**:

```typescript
// Line 233, inside existingTests.map():
{
	existingTests.map(test => {
		// Calculate real statistics from events
		const stats = calculateStatistics(test.events);

		// Rest of component rendering...
	});
}
```

**Update for Missing Fields**: The `ABTestStats` type from statistics.ts doesn't include purchases and revenue. Update the display to handle this:

```typescript
// When displaying purchases (line 399):
<Text as="span" variant="bodySm">
  {stats.variantA.addToCarts.toLocaleString()}
</Text>

// When displaying revenue (line 405):
<Text as="span" variant="bodySm">
  ${((stats.variantA as any).revenue || 0).toFixed(2)}
</Text>
```

**Better Solution**: Update the statistics utility to include purchases and revenue (this is what the duplicate code in `app.ab-tests.$id.tsx` has).

**Estimated Time**: 30 minutes

---

#### 1.4 Consolidate Statistics Code

**Task**: Remove duplicate statistics calculation

**File to Update**: `app/routes/app.ab-tests.$id.tsx`

**Changes**:

```typescript
// At top of file, add import:
import { calculateStatistics } from '~/features/ab-testing/utils/statistics';

// REMOVE calculateStatistics function (lines 51-121)

// REPLACE usage (line 125):
// OLD:
const stats = calculateStatistics(abTest.events);

// NEW (same call, just using imported function):
const stats = calculateStatistics(abTest.events);
```

**Issue**: The statistics utility doesn't track purchases and revenue separately. Need to enhance it.

**Update**: `app/features/ab-testing/utils/statistics.ts`

Add to `ABTestStats` interface:

```typescript
export interface ABTestStats {
	variantA: {
		impressions: number;
		addToCarts: number; // ADD THIS
		purchases: number; // ADD THIS
		revenue: number; // ADD THIS
		conversions: number;
		rate: number;
		ratePercent: string;
	};
	variantB: {
		impressions: number;
		addToCarts: number; // ADD THIS
		purchases: number; // ADD THIS
		revenue: number; // ADD THIS
		conversions: number;
		rate: number;
		ratePercent: string;
	};
	lift: string;
	confidence: string;
	isSignificant: boolean;
	winner: 'A' | 'B' | null;
	sampleSize: number;
}
```

Update `calculateStatistics` function:

```typescript
export function calculateStatistics(events: ABTestEvent[]): ABTestStats {
	const variantAEvents = events.filter(e => e.variant === 'A');
	const variantBEvents = events.filter(e => e.variant === 'B');

	const variantAImpressions = variantAEvents.filter(e => e.eventType === 'IMPRESSION').length;
	const variantBImpressions = variantBEvents.filter(e => e.eventType === 'IMPRESSION').length;

	const variantAAddToCarts = variantAEvents.filter(e => e.eventType === 'ADD_TO_CART').length;
	const variantBAddToCarts = variantBEvents.filter(e => e.eventType === 'ADD_TO_CART').length;

	// ADD: Purchases tracking
	const variantAPurchases = variantAEvents.filter(e => e.eventType === 'PURCHASE').length;
	const variantBPurchases = variantBEvents.filter(e => e.eventType === 'PURCHASE').length;

	// ADD: Revenue tracking
	const variantARevenue = variantAEvents
		.filter(e => e.eventType === 'PURCHASE')
		.reduce((sum, e) => sum + (Number(e.revenue) || 0), 0);
	const variantBRevenue = variantBEvents
		.filter(e => e.eventType === 'PURCHASE')
		.reduce((sum, e) => sum + (Number(e.revenue) || 0), 0);

	const variantARate = variantAImpressions > 0 ? variantAAddToCarts / variantAImpressions : 0;
	const variantBRate = variantBImpressions > 0 ? variantBAddToCarts / variantBImpressions : 0;

	// ... existing statistical significance calculation ...

	return {
		variantA: {
			impressions: variantAImpressions,
			addToCarts: variantAAddToCarts, // ADD
			purchases: variantAPurchases, // ADD
			revenue: variantARevenue, // ADD
			conversions: variantAAddToCarts,
			rate: variantARate,
			ratePercent: (variantARate * 100).toFixed(2),
		},
		variantB: {
			impressions: variantBImpressions,
			addToCarts: variantBAddToCarts, // ADD
			purchases: variantBPurchases, // ADD
			revenue: variantBRevenue, // ADD
			conversions: variantBAddToCarts,
			rate: variantBRate,
			ratePercent: (variantBRate * 100).toFixed(2),
		},
		lift: lift.toFixed(2),
		confidence: confidence.toFixed(1),
		isSignificant: confidence >= 95,
		winner,
		sampleSize: n1 + n2,
	};
}
```

**Estimated Time**: 1 hour

---

**Phase 1 Total Estimated Time**: 6-8 hours

---

### Phase 2: File Upload Implementation (REDESIGNED)

**Duration**: 5-6 hours
**Priority**: MEDIUM

#### 2.1 Create File Upload Service

**Task**: Implement 3-step staged upload process

**New File**: `app/services/file-upload.server.ts`

```typescript
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';

interface StagedUploadTarget {
	url: string;
	resourceUrl: string;
	parameters: Array<{ name: string; value: string }>;
}

interface UploadOptions {
	filename: string;
	mimeType: string;
	fileSize: number;
	altText?: string;
}

interface UploadedFile {
	id: string;
	url: string;
	altText: string | null;
}

/**
 * Step 1: Create staged upload target
 */
async function createStagedUpload(admin: AdminApiContext, options: UploadOptions): Promise<StagedUploadTarget> {
	const mutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

	const response = await admin.graphql(mutation, {
		variables: {
			input: [
				{
					filename: options.filename,
					mimeType: options.mimeType,
					resource: 'PRODUCT_IMAGE',
					fileSize: options.fileSize.toString(),
					httpMethod: 'POST',
				},
			],
		},
	});

	const result = await response.json();

	if (result.data?.stagedUploadsCreate?.userErrors?.length > 0) {
		throw new Error(result.data.stagedUploadsCreate.userErrors[0].message);
	}

	const stagedTarget = result.data?.stagedUploadsCreate?.stagedTargets?.[0];

	if (!stagedTarget) {
		throw new Error('Failed to create staged upload');
	}

	return stagedTarget;
}

/**
 * Step 2: Upload file to staged URL
 */
async function uploadToStagedUrl(
	url: string,
	file: File,
	parameters: Array<{ name: string; value: string }>,
): Promise<void> {
	const formData = new FormData();

	// IMPORTANT: Parameters must be added in order
	parameters.forEach(param => {
		formData.append(param.name, param.value);
	});

	// File must be added last
	formData.append('file', file);

	const response = await fetch(url, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		throw new Error(`Upload failed: ${response.statusText}`);
	}
}

/**
 * Step 3: Create file asset in Shopify
 */
async function createFileAsset(
	admin: AdminApiContext,
	resourceUrl: string,
	filename: string,
	altText?: string,
): Promise<{ id: string }> {
	const mutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          ... on MediaImage {
            id
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

	const response = await admin.graphql(mutation, {
		variables: {
			files: [
				{
					originalSource: resourceUrl,
					contentType: 'IMAGE',
					alt: altText || filename,
				},
			],
		},
	});

	const result = await response.json();

	if (result.data?.fileCreate?.userErrors?.length > 0) {
		throw new Error(result.data.fileCreate.userErrors[0].message);
	}

	const file = result.data?.fileCreate?.files?.[0];

	if (!file) {
		throw new Error('Failed to create file asset');
	}

	return { id: file.id };
}

/**
 * Step 4: Poll for file processing completion
 */
async function pollFileProcessing(
	admin: AdminApiContext,
	fileId: string,
	maxAttempts = 10,
	delayMs = 1000,
): Promise<UploadedFile> {
	const query = `
    query getFile($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          id
          status
          image {
            url
            altText
          }
        }
      }
    }
  `;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const response = await admin.graphql(query, {
			variables: { id: fileId },
		});

		const result = await response.json();
		const file = result.data?.node;

		if (file?.status === 'READY' && file?.image?.url) {
			return {
				id: file.id,
				url: file.image.url,
				altText: file.image.altText,
			};
		}

		if (file?.status === 'FAILED') {
			throw new Error('File processing failed');
		}

		// Wait before next attempt
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}

	throw new Error('File processing timeout');
}

/**
 * Main upload function - orchestrates all steps
 */
export async function uploadImageToShopify(
	admin: AdminApiContext,
	file: File,
	altText?: string,
): Promise<UploadedFile> {
	// Validation
	const maxSize = 10 * 1024 * 1024; // 10MB
	const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

	if (file.size > maxSize) {
		throw new Error(`File too large. Maximum size is ${maxSize / 1024 / 1024}MB`);
	}

	if (!allowedTypes.includes(file.type)) {
		throw new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`);
	}

	try {
		// Step 1: Create staged upload
		const stagedTarget = await createStagedUpload(admin, {
			filename: file.name,
			mimeType: file.type,
			fileSize: file.size,
			altText,
		});

		// Step 2: Upload file
		await uploadToStagedUrl(stagedTarget.url, file, stagedTarget.parameters);

		// Step 3: Create file asset
		const fileAsset = await createFileAsset(admin, stagedTarget.resourceUrl, file.name, altText);

		// Step 4: Poll for completion
		const uploadedFile = await pollFileProcessing(admin, fileAsset.id);

		return uploadedFile;
	} catch (error) {
		console.error('File upload failed:', error);
		throw error;
	}
}
```

**Estimated Time**: 2.5 hours

---

#### 2.2 Create Upload UI Component

**Task**: Build image uploader with progress

**New File**: `app/features/ai-studio/components/ImageUploader.tsx`

```typescript
import { useState, useCallback } from "react";
import {
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  DropZone,
  Thumbnail,
  ProgressBar,
  Banner,
} from "@shopify/polaris";

interface ImageUploaderProps {
  onUpload: (files: File[]) => Promise<void>;
  maxFiles?: number;
  maxSizeM?: number;
}

export function ImageUploader({
  onUpload,
  maxFiles = 5,
  maxSizeMB = 10,
}: ImageUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    (_droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        setError("Some files were rejected. Please check file type and size.");
        return;
      }

      if (acceptedFiles.length + files.length > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate file sizes
      const oversized = acceptedFiles.filter(
        file => file.size > maxSizeMB * 1024 * 1024
      );

      if (oversized.length > 0) {
        setError(`Files must be under ${maxSizeMB}MB`);
        return;
      }

      setFiles(prev => [...prev, ...acceptedFiles]);
    },
    [files, maxFiles, maxSizeMB]
  );

  const handleRemove = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const totalFiles = files.length;

      for (let i = 0; i < totalFiles; i++) {
        await onUpload([files[i]]);
        setProgress(((i + 1) / totalFiles) * 100);
      }

      // Success - clear files
      setFiles([]);
      setProgress(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [files, onUpload]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Upload Images
        </Text>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        <DropZone
          accept="image/*"
          type="image"
          onDrop={handleDrop}
          allowMultiple
          disabled={uploading}
        >
          <DropZone.FileUpload
            actionTitle="Add images"
            actionHint={`or drop files to upload (max ${maxFiles} images, ${maxSizeMB}MB each)`}
          />
        </DropZone>

        {files.length > 0 && (
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </Text>

            <InlineStack gap="200" wrap>
              {files.map((file, index) => (
                <div key={index} style={{ position: 'relative' }}>
                  <Thumbnail
                    source={URL.createObjectURL(file)}
                    alt={file.name}
                    size="large"
                  />
                  {!uploading && (
                    <Button
                      size="micro"
                      variant="plain"
                      tone="critical"
                      onClick={() => handleRemove(index)}
                      disabled={uploading}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </InlineStack>

            {uploading && (
              <BlockStack gap="200">
                <ProgressBar progress={progress} size="small" />
                <Text as="p" variant="bodySm" tone="subdued">
                  Uploading... {Math.round(progress)}%
                </Text>
              </BlockStack>
            )}

            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                loading={uploading}
              >
                Upload {files.length} image{files.length !== 1 ? 's' : ''}
              </Button>

              {!uploading && (
                <Button
                  variant="plain"
                  onClick={() => setFiles([])}
                  disabled={uploading}
                >
                  Clear all
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
```

**Estimated Time**: 1.5 hours

---

#### 2.3 Add Upload Route Handler

**Task**: Create API endpoint for image uploads

**Update**: `app/routes/app.ai-studio.tsx`

Add upload intent handler to action function:

```typescript
import { uploadImageToShopify } from '~/services/file-upload.server';

export const action = async ({ request }: ActionFunctionArgs) => {
	const { session, admin } = await authenticate.admin(request);
	const formData = await request.formData();
	const intent = String(formData.get('intent'));

	// ... existing intents (generate, save_draft, etc.) ...

	// NEW: Upload intent
	if (intent === 'upload') {
		const file = formData.get('file') as File;
		const productId = String(formData.get('productId'));

		if (!file || !file.size) {
			return json({ ok: false, error: 'No file provided' }, { status: 400 });
		}

		try {
			// Upload to Shopify using staged upload
			const uploadedFile = await uploadImageToShopify(
				admin,
				file,
				`AI Studio upload - ${new Date().toISOString()}`,
			);

			// Add to product's AI library metafield
			const query = `#graphql
        query GetLibrary($id: ID!) {
          product(id: $id) {
            id
            metafield(namespace: "dreamshot", key: "ai_library") {
              id
              value
            }
          }
        }
      `;

			const qRes = await admin.graphql(query, {
				variables: { id: productId },
			});
			const qJson = await qRes.json();

			const current = qJson?.data?.product?.metafield?.value;
			let libraryItems = current ? JSON.parse(current) : [];

			// Add uploaded image to library
			libraryItems.push({
				imageUrl: uploadedFile.url,
				sourceUrl: null,
				uploadedAt: new Date().toISOString(),
			});

			// Save updated library
			const setMutation = `#graphql
        mutation SetLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId,
            namespace: "dreamshot",
            key: "ai_library",
            type: "json",
            value: $value
          }]) {
            metafields { id }
            userErrors { field message }
          }
        }
      `;

			const setRes = await admin.graphql(setMutation, {
				variables: {
					ownerId: productId,
					value: JSON.stringify(libraryItems),
				},
			});

			const setJson = await setRes.json();

			if (setJson?.data?.metafieldsSet?.userErrors?.length > 0) {
				throw new Error(setJson.data.metafieldsSet.userErrors[0].message);
			}

			return json({
				ok: true,
				imageUrl: uploadedFile.url,
				message: 'Image uploaded successfully',
			});
		} catch (error) {
			console.error('Upload failed:', error);
			return json(
				{
					ok: false,
					error: error instanceof Error ? error.message : 'Upload failed',
				},
				{ status: 500 },
			);
		}
	}

	// ... rest of action handlers ...
};
```

**Estimated Time**: 1 hour

---

#### 2.4 Integrate Uploader into AI Studio

**Task**: Add uploader to AI Studio page

**Update**: `app/routes/app.ai-studio.tsx` (component)

```typescript
import { ImageUploader } from "~/features/ai-studio/components/ImageUploader";

// Inside the component, after library grid:

<ImageUploader
  onUpload={async (files) => {
    for (const file of files) {
      const formData = new FormData();
      formData.set("intent", "upload");
      formData.set("file", file);
      formData.set("productId", product?.id || "");

      await fetcher.submit(formData, {
        method: "POST",
        encType: "multipart/form-data"
      });
    }

    // Reload to show new images
    window.location.reload();
  }}
  maxFiles={5}
  maxSizeMB={10}
/>
```

**Estimated Time**: 30 minutes

---

**Phase 2 Total Estimated Time**: 5-6 hours

---

### Phase 3: Quality Assurance & Testing (NEW)

**Duration**: 4-6 hours
**Priority**: HIGH

#### 3.1 Theme Compatibility Testing

**Task**: Test image replacement on multiple themes

**Test Matrix**:

| Theme    | Version | Test Result | Notes                           |
| -------- | ------- | ----------- | ------------------------------- |
| Dawn     | Latest  | ✅          | Default theme, primary selector |
| Debut    | Legacy  | ⚠️          | Different selectors needed      |
| Brooklyn | OS 1.0  | ⚠️          | Limited support                 |
| Prestige | Popular | TBD         | Premium theme                   |
| Empire   | Popular | TBD         | Premium theme                   |
| Custom   | Varies  | TBD         | Merchant-specific               |

**Test Process**:

1. Install app on dev store with each theme
2. Create A/B test with 2 different images
3. Visit product page in incognito
4. Verify images replaced
5. Test add-to-cart tracking
6. Check events in database

**Documentation**: Create compatibility matrix in docs.

**Estimated Time**: 2 hours

---

#### 3.2 Performance Testing

**Task**: Ensure tracking doesn't slow down storefront

**Metrics to Test**:

- Page load time impact (<50ms target)
- Time to first byte (TTFB)
- DOM manipulation time
- Network request overhead
- Database query performance

**Tools**:

- Lighthouse CI
- WebPageTest
- Chrome DevTools Performance
- Database query analyzer

**Load Testing**:

```bash
# Simulate 1000 concurrent users
artillery quick --count 1000 --num 10 https://dev-store.myshopify.com/products/test-product
```

**Estimated Time**: 1.5 hours

---

#### 3.3 Security Audit

**Task**: Verify all security measures

**Checklist**:

- ✅ HMAC validation on app proxy routes
- ✅ Shop context verification
- ✅ Input validation (file uploads, event data)
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS prevention (React sanitization)
- ✅ CSRF protection (Shopify handles this)
- ✅ Rate limiting (implement if needed)

**Test Cases**:

1. Attempt forged app proxy request (should fail HMAC)
2. Try uploading malicious file (should be rejected)
3. Send oversized request (should be limited)
4. Test with invalid shop parameter (should be rejected)

**Estimated Time**: 1 hour

---

#### 3.4 Privacy Compliance

**Task**: Verify GDPR/CCPA compliance

**Requirements**:

- ✅ Web Pixels respect customer consent
- ✅ No tracking without consent in EU
- ✅ Data deletion on app uninstall
- ✅ Clear privacy policy
- ✅ Customer data not shared with third parties

**Implementation**:
Web Pixels API automatically handles consent via Customer Privacy API.

**Add Webhook Handler** for data deletion:

**Update**: `app/routes/webhooks.app.uninstalled.tsx`

```typescript
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
	const { shop } = await authenticate.webhook(request);

	// Delete all A/B test data for this shop
	await db.aBTest.deleteMany({
		where: { shop },
	});

	// Events and variants cascade delete automatically

	console.log(`Deleted A/B test data for shop: ${shop}`);

	return new Response(null, { status: 200 });
};
```

**Estimated Time**: 30 minutes

---

#### 3.5 End-to-End Testing

**Task**: Test complete user flow

**Test Scenarios**:

**Scenario 1: Create and Run Test**

1. ✅ Merchant logs into app
2. ✅ Navigates to product in AI Studio
3. ✅ Generates 2 AI images
4. ✅ Creates A/B test with images
5. ✅ Starts test (status → RUNNING)
6. ✅ Visits product page on storefront
7. ✅ Images are replaced
8. ✅ Adds product to cart
9. ✅ Events tracked in database
10. ✅ Statistics update in admin

**Scenario 2: Multiple Sessions**

1. ✅ Create test with 50/50 split
2. ✅ Visit in 10 different sessions
3. ✅ Verify ~50% see each variant
4. ✅ Verify same session sees same variant

**Scenario 3: File Upload**

1. ✅ Upload custom image (5MB)
2. ✅ Image appears in library
3. ✅ Create test with uploaded image
4. ✅ Verify displays on storefront

**Scenario 4: Error Handling**

1. ✅ Try uploading 15MB file (should fail)
2. ✅ Try uploading .exe file (should fail)
3. ✅ Stop test mid-run (should work)
4. ✅ Delete test with events (should cascade)

**Estimated Time**: 1-2 hours

---

**Phase 3 Total Estimated Time**: 4-6 hours

---

## Updated Timeline Summary

| Phase       | Description           | Original v1.0 | Updated v2.0 | Increase    |
| ----------- | --------------------- | ------------- | ------------ | ----------- |
| **Phase 0** | Foundation & Security | -             | 2-3h         | +2-3h       |
| **Phase 1** | Modern Tracking       | 4-6h          | 6-8h         | +2h         |
| **Phase 2** | File Upload           | 3-4h          | 5-6h         | +2h         |
| **Phase 3** | QA & Testing          | -             | 4-6h         | +4-6h       |
| **TOTAL**   |                       | **9-13h**     | **20-27h**   | **+11-14h** |

**Realistic Estimate**: 20-27 hours (~3-4 work days)

---

## Success Criteria (Updated)

### Phase 0: Foundation

✅ Database indexes created and verified with `.schema` command
✅ App proxy routes use `authenticate.public.appProxy`
✅ HMAC validation working (test with forged requests)
✅ Health check endpoint returns shop context
✅ Environment variables documented

### Phase 1: Modern Tracking

✅ App proxy configured with `${SHOPIFY_APP_URL}`
✅ **Web Pixels extension deployed** (not ScriptTag)
✅ Tracking works on product, checkout, thank-you pages
✅ Images replaced on product pages (90%+ success rate)
✅ Events tracked with proper authentication
✅ Real statistics displayed (no more mock data)
✅ Privacy API compliance verified

### Phase 2: File Upload

✅ 3-step staged upload implemented
✅ File validation working (size, type, dimensions)
✅ Upload progress shown to user
✅ Async processing handled (polling until ready)
✅ Failed uploads show clear error messages
✅ Uploaded images appear in library
✅ Can create A/B tests with uploaded images

### Phase 3: QA & Testing

✅ Tested on 5+ themes (documented compatibility)
✅ Performance targets met (<50ms page load impact)
✅ Security audit passed (HMAC validation working)
✅ Privacy compliance verified (GDPR/CCPA)
✅ End-to-end tests passing
✅ No console errors on storefront
✅ Database query performance acceptable (<100ms)

---

## Risk Assessment

### 🔴 HIGH RISK

**1. Theme Compatibility**

- **Risk**: Image replacement may not work on all themes
- **Likelihood**: Medium (product media structure varies)
- **Impact**: High (feature doesn't work for some merchants)
- **Mitigation**:
    - Test on popular themes (Phase 3.1)
    - Multiple selector strategies in script
    - Fallback mechanisms
    - Clear compatibility docs for merchants
    - Consider offering installation support

**2. Web Pixels Limitations**

- **Risk**: Sandboxed environment limits DOM access
- **Likelihood**: Medium (platform limitation)
- **Impact**: High (can't manipulate images directly)
- **Mitigation**:
    - Hybrid approach with lightweight script
    - Test thoroughly in sandbox
    - Document limitations

### 🟠 MEDIUM RISK

**3. App Proxy Performance**

- **Risk**: Too many requests slow down storefront
- **Likelihood**: Low (only on product pages)
- **Impact**: Medium (poor user experience)
- **Mitigation**:
    - Implement caching (5-min TTL)
    - Optimize database queries with indexes
    - Monitor response times
    - Add rate limiting if needed

**4. File Upload Failures**

- **Risk**: Staged upload process fails
- **Likelihood**: Medium (network issues, timeouts)
- **Impact**: Medium (user frustration)
- **Mitigation**:
    - Comprehensive error handling
    - Retry logic with exponential backoff
    - Clear error messages
    - Progress indication

**5. Statistical Accuracy**

- **Risk**: Wrong calculations lead to bad decisions
- **Likelihood**: Low (using proven formulas)
- **Impact**: High (merchants make wrong choices)
- **Mitigation**:
    - Peer review statistical code
    - Unit tests for calculations
    - Compare with industry tools (Optimizely, VWO)
    - Show confidence intervals

### 🟢 LOW RISK

**6. Database Performance**

- **Risk**: Slow queries as data grows
- **Likelihood**: Low (indexes in place)
- **Impact**: Medium (slow admin UI)
- **Mitigation**:
    - Proper indexes (Phase 0)
    - Monitor query performance
    - Archive old tests
    - Implement pagination

---

## Technical Debt to Address

### Identified Issues

1. **Duplicate Statistics Code** ✅ Addressed in Phase 1.4
    - Location: `app.ab-tests.$id.tsx` lines 51-121
    - Action: Removed, using shared utility

2. **Missing Type Definitions**
    - File upload response types incomplete
    - Web Pixels event types not defined
    - Action: Add comprehensive TypeScript types

3. **No Error Codes**
    - Errors are just strings
    - Hard to handle programmatically
    - Action: Create error enum/codes

4. **No Monitoring**
    - No structured logging
    - No error tracking service
    - Action: Add Sentry or similar

5. **No Rate Limiting**
    - App proxy endpoints open to abuse
    - Action: Add rate limiting middleware

---

## Future Enhancements (Post-MVP)

### Short-term (1-3 months)

1. **Multi-Variate Testing (A/B/C/D)**
    - Support 3+ variants
    - More complex statistics (ANOVA)
    - Priority: Medium

2. **Segment-Based Testing**
    - Different variants for different segments
    - Geographic targeting
    - Device type targeting
    - Priority: Medium

3. **Auto-Winner Selection**
    - Automatically switch to winner after significance
    - Gradual rollout (increase traffic to winner)
    - Priority: Low

### Long-term (3-6 months)

4. **Heatmaps & Click Tracking**
    - Track where users click on images
    - Visual heatmap overlay
    - Priority: Low

5. **Integration with Analytics**
    - Export to Google Analytics
    - Integration with Mixpanel, Amplitude
    - Priority: Medium

6. **Advanced Statistics**
    - Bayesian analysis option
    - Multi-armed bandit algorithms
    - Time-series analysis
    - Priority: Low

---

## Documentation Requirements

### For Developers

1. **Architecture Decision Records (ADRs)**
    - Why Web Pixels over ScriptTag
    - Why staged upload over direct upload
    - Authentication strategy rationale

2. **API Documentation**
    - App proxy endpoints
    - Request/response formats
    - Error codes

3. **Development Setup**
    - Environment variables
    - Local development workflow
    - Testing procedures

### For Merchants

1. **Installation Guide**
    - App installation steps
    - Extension activation (Web Pixels)
    - Theme compatibility check

2. **User Guide**
    - Creating A/B tests
    - Understanding statistics
    - Interpreting results
    - Best practices

3. **Troubleshooting**
    - Common issues
    - Theme compatibility
    - Performance optimization

4. **Privacy & Compliance**
    - GDPR compliance statement
    - Data retention policy
    - Customer consent handling

---

## Appendix

### Resources

**Shopify Documentation**:

- [Web Pixels API](https://shopify.dev/docs/apps/build/marketing-analytics/pixels)
- [App Proxy](https://shopify.dev/docs/apps/online-store/app-proxies)
- [Files API (Staged Upload)](https://shopify.dev/docs/api/admin-graphql/latest/mutations/stagedUploadsCreate)
- [Theme App Extensions](https://shopify.dev/docs/apps/online-store/theme-app-extensions)
- [Customer Privacy API](https://shopify.dev/docs/api/customer-privacy)

**Statistical Testing**:

- [Optimizely Stats Engine](https://www.optimizely.com/optimization-glossary/statistical-significance/)
- [Evan Miller's A/B Test Calculator](https://www.evanmiller.org/ab-testing/)

**Deprecation Notices**:

- [ScriptTag Deprecation](https://shopify.dev/docs/apps/build/online-store/blocking-script-tags)

### Glossary

- **App Proxy**: Shopify configuration that routes storefront URLs to app backend with HMAC validation
- **Web Pixels**: Modern, sandboxed tracking mechanism (replaces ScriptTag)
- **Staged Upload**: 3-step file upload process (stage → upload → finalize)
- **HMAC**: Hash-based Message Authentication Code for request validation
- **CVR**: Conversion Rate (conversions / impressions)
- **Lift**: Percentage improvement of variant B over variant A
- **Statistical Significance**: Confidence that results aren't due to chance (typically 95%)
- **Z-test**: Statistical test for comparing two proportions
- **Sandbox**: Isolated environment for running code securely

---

## Revision History

| Version | Date       | Changes                                   | Author             |
| ------- | ---------- | ----------------------------------------- | ------------------ |
| 1.0     | 2025-10-01 | Initial PRD                               | Original Author    |
| 2.0     | 2025-10-01 | Major revision with 2025 platform updates | Claude Code Review |

**Key Changes in v2.0**:

1. ✅ Replaced ScriptTag with Web Pixels API (critical)
2. ✅ Added `authenticate.public.appProxy` security layer
3. ✅ Redesigned file upload with 3-step staged process
4. ✅ Added Phase 0 for foundation & security
5. ✅ Added Phase 3 for QA & testing
6. ✅ Identified and addressed code duplication
7. ✅ Added database performance indexes
8. ✅ Doubled timeline for realistic estimates
9. ✅ Enhanced risk assessment
10. ✅ Added comprehensive documentation requirements

---

**END OF PRD v2.0**

_This document should be reviewed and updated as implementation progresses and new requirements are discovered._
