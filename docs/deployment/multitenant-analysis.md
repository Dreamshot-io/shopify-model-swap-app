# Multitenant Compatibility Analysis

## Summary

The app has been modified to support multitenancy through a `ShopCredential` model and `shopId` foreign keys. However, **queries are not consistently filtering by `shopId`**, creating potential data isolation issues.

## Changes Made

### 1. Database Schema (`prisma/schema.prisma`)

**New Model:**
- `ShopCredential`: Stores per-shop API credentials with encrypted `apiSecret`
  - `id` (cuid)
  - `shopDomain` (unique)
  - `apiKey`, `apiSecret` (encrypted)
  - `appHandle`, `appUrl`, `scopes`, etc.

**Modified Models (added `shopId` field):**
- `Session` - links to ShopCredential
- `ABTest` - links to ShopCredential  
- `AuditLog` - links to ShopCredential
- `MetricEvent` - links to ShopCredential
- `ProductSuggestionRule` - links to ShopCredential
- `GenerationHistory` - links to ShopCredential
- `AIStudioImage` - links to ShopCredential

### 2. Database Layer (`app/db.server.ts`)

**Features:**
- Prisma extension for transparent encryption/decryption of `apiSecret`
- ShopId caching (`shopIdCache`) for performance
- `rememberShopId()` / `forgetShopId()` cache management
- `lookupShopId()` - resolves shop domain → shopId
- `attachShopId()` - helper to populate shopId on data objects
- `SHOP_AWARE_MODELS` - list of models that need shopId

**Issues:**
- `attachShopId()` exists but is **not being called** in query operations
- No automatic shopId population in Prisma queries

### 3. Shop Credential Service (`app/services/shops.server.ts`)

**Features:**
- `findShopCredential()` - lookup by domain/id/clientId with caching
- `requireShopCredential()` - throws 404 if not found
- `createShopCredential()` / `updateShopCredential()` - CRUD with encryption
- Cache invalidation support

### 4. Authentication (`app/shopify.server.ts`)

**Features:**
- `resolveCredentialFromRequest()` - extracts credential from request
- Supports clientId (apiKey) or shopDomain lookup
- Creates Shopify app instance per credential

## Critical Issues

### ❌ Issue 1: Queries Not Filtering by shopId

**Current State:**
- Queries filter by `shop: string` (domain), NOT `shopId`
- Example from `ai-studio-media.server.ts`:
  ```typescript
  await this.prisma.aIStudioImage.findMany({
    where: {
      shop: input.shop,  // ❌ Using shop domain, not shopId
      productId: input.productId,
    },
  });
  ```

**Risk:**
- If shop domains change or are inconsistent, data isolation breaks
- shopId is the source of truth, but queries ignore it
- No enforcement of multitenant boundaries

**Required Fix:**
- All queries should filter by `shopId`, not `shop`
- Need to resolve shopId from session/request context
- Update all query sites (handlers, services, routes)

### ❌ Issue 2: shopId Not Being Set on Create Operations

**Current State:**
- Create operations pass `shop: string` but not `shopId`
- Example:
  ```typescript
  await db.metricEvent.create({
    data: {
      shop,  // ❌ Only shop domain
      // shopId missing
    },
  });
  ```

**Required Fix:**
- Resolve shopId from shop domain before creates
- Use `lookupShopId()` or session.shopId
- Populate shopId in all create operations

### ❌ Issue 3: No Migration Strategy

**Missing:**
- Migration script to populate shopId for existing records
- Backfill strategy for historical data
- Validation that all records have shopId

## Testing Requirements

### Current Test Infrastructure

**Existing Tests:**
- `app/shopify.server.test.ts` - basic helper tests (Jest)
- `app/services/ai-providers.test.ts` - provider tests (Jest)
- `app/routes/api.test.ts` - route tests (Jest)

**Test Framework:**
- Uses `@jest/globals` but **no vitest config**
- No test database setup
- No integration tests

### Required Test Coverage

#### 1. Unit Tests (Vitest)

**Database Layer (`app/db.server.ts`):**
- ✅ `lookupShopId()` - resolves domain to ID
- ✅ `rememberShopId()` / `forgetShopId()` - cache management
- ✅ Encryption/decryption extension works correctly
- ✅ `attachShopId()` populates shopId correctly

**Shop Service (`app/services/shops.server.ts`):**
- ✅ `findShopCredential()` - lookup by domain/id/clientId
- ✅ `requireShopCredential()` - throws 404 when missing
- ✅ Cache invalidation works
- ✅ Encryption on create/update

**Authentication (`app/shopify.server.ts`):**
- ✅ `resolveCredentialFromRequest()` - extracts credential
- ✅ `extractShopDomain()` - parses shop from various sources
- ✅ App instance creation per credential

#### 2. Integration Tests (Vitest + Test DB)

**Multitenant Isolation:**
- ✅ Shop A cannot access Shop B's data
- ✅ Queries filter by shopId correctly
- ✅ Create operations set shopId
- ✅ Updates respect shopId boundaries
- ✅ Deletes respect shopId boundaries

**Data Models:**
- ✅ `AIStudioImage` - shopId filtering
- ✅ `MetricEvent` - shopId filtering
- ✅ `GenerationHistory` - shopId filtering
- ✅ `ABTest` - shopId filtering
- ✅ `ProductSuggestionRule` - shopId filtering
- ✅ `AuditLog` - shopId filtering

**Session Management:**
- ✅ Sessions link to correct shopId
- ✅ Session queries filter by shopId
- ✅ Multiple shops can have sessions simultaneously

#### 3. E2E Tests (Optional)

**Critical Flows:**
- ✅ App installation creates ShopCredential
- ✅ Session creation links to ShopCredential
- ✅ AI Studio operations isolated per shop
- ✅ AB Test operations isolated per shop

## Deployment Checklist

### Pre-Deployment

- [ ] **Fix all queries to filter by shopId**
  - Audit all `prisma.*.findMany/findFirst/create/update` calls
  - Replace `shop: string` filters with `shopId: string`
  - Resolve shopId from session/request context

- [ ] **Backfill shopId for existing records**
  - Create migration script to populate shopId
  - Match records by shop domain → shopId
  - Validate all records have shopId after migration

- [ ] **Add shopId to all create operations**
  - Update handlers to resolve shopId before creates
  - Use `lookupShopId()` or session.shopId
  - Ensure shopId is always set

- [ ] **Add database constraints**
  - Make shopId NOT NULL where appropriate
  - Add foreign key constraints
  - Add indexes on shopId for performance

### Testing

- [ ] **Set up Vitest**
  - Install vitest: `bun add -d vitest @vitest/ui`
  - Create `vitest.config.ts`
  - Configure test database (PostgreSQL test instance)

- [ ] **Write unit tests**
  - Database layer tests
  - Shop service tests
  - Authentication tests

- [ ] **Write integration tests**
  - Multitenant isolation tests
  - Query filtering tests
  - Create/update/delete tests

- [ ] **Run test suite**
  - All tests pass
  - Coverage > 80% for critical paths
  - No flaky tests

### Deployment

- [ ] **Run migration**
  - Backfill shopId for existing records
  - Verify migration success
  - Check for orphaned records

- [ ] **Deploy to staging**
  - Test with multiple shops
  - Verify data isolation
  - Monitor for errors

- [ ] **Deploy to production**
  - Gradual rollout if possible
  - Monitor error rates
  - Verify shopId population

### Post-Deployment

- [ ] **Monitor**
  - Check for queries missing shopId
  - Verify shopId population rate
  - Monitor performance (indexes working)

- [ ] **Validation Scripts**
  - Run `scripts/verify-credentials.mjs`
  - Run `scripts/verify-installs.mjs`
  - Check for data inconsistencies

## Vitest Setup

### Required Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
  },
});
```

### Test Database Setup

```typescript
// test/setup.ts
import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL,
    },
  },
});

beforeAll(async () => {
  // Run migrations
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

### Example Test

```typescript
// app/services/shops.server.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { findShopCredential, createShopCredential } from './shops.server';
import { prisma } from '../db.server';

describe('Shop Credential Service', () => {
  beforeEach(async () => {
    // Clean test data
    await prisma.shopCredential.deleteMany();
  });

  it('should find credential by domain', async () => {
    const cred = await createShopCredential({
      shopDomain: 'test.myshopify.com',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      appHandle: 'test-app',
      appUrl: 'https://test.com',
      scopes: ['read_products'],
    });

    const found = await findShopCredential({ shopDomain: 'test.myshopify.com' });
    expect(found?.id).toBe(cred.id);
  });

  it('should isolate data by shopId', async () => {
    // Create two shops
    const shop1 = await createShopCredential({...});
    const shop2 = await createShopCredential({...});

    // Create data for shop1
    await prisma.metricEvent.create({
      data: {
        shop: shop1.shopDomain,
        shopId: shop1.id,
        eventType: 'TEST',
      },
    });

    // Query for shop2 should return empty
    const events = await prisma.metricEvent.findMany({
      where: { shopId: shop2.id },
    });
    expect(events).toHaveLength(0);
  });
});
```

## Priority Actions

### 🔴 Critical (Before Deployment)

1. **Fix query filtering** - Replace `shop: string` with `shopId: string` in all queries
2. **Backfill shopId** - Migrate existing records to have shopId
3. **Add shopId to creates** - Ensure all create operations set shopId

### 🟡 High (Before Production)

4. **Set up Vitest** - Configure test framework
5. **Write isolation tests** - Verify multitenant boundaries
6. **Add database constraints** - Enforce shopId requirements

### 🟢 Medium (Post-Deployment)

7. **Add monitoring** - Track shopId population rate
8. **Performance optimization** - Index shopId fields
9. **Documentation** - Update API docs with shopId requirements

## Unresolved Questions

1. **Migration Strategy**: How to handle shops that don't have ShopCredential yet?
2. **Session Linking**: Are existing sessions being linked to ShopCredential automatically?
3. **Rollback Plan**: If deployment fails, how to rollback shopId changes?
4. **Performance**: Will shopId lookups impact query performance? Need benchmarks.
