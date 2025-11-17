# Multitenant Testing & Deployment Plan

## Quick Summary

**Status:** Multitenant infrastructure added but **not fully implemented**
- ✅ Schema has shopId fields
- ✅ ShopCredential model exists
- ❌ Queries still filter by `shop` domain, not `shopId`
- ❌ shopId not being set on create operations
- ❌ No tests for multitenant isolation

## Critical Fixes Required

### 1. Query Filtering (🔴 Critical)

**Problem:** All queries use `shop: string` instead of `shopId: string`

**Files to Fix:**
- `app/services/ai-studio-media.server.ts` - All queries
- `app/features/ai-studio/handlers/*.ts` - Create operations
- `app/routes/app.*.tsx` - Loader/action queries
- Any other files using `prisma.*.findMany/findFirst/create/update`

**Pattern:**
```typescript
// ❌ Current
where: { shop: input.shop }

// ✅ Should be
where: { shopId: shopId }
```

### 2. Create Operations (🔴 Critical)

**Problem:** Create operations don't set `shopId`

**Fix:**
```typescript
// ❌ Current
await db.metricEvent.create({
  data: { shop, eventType: 'TEST' }
});

// ✅ Should be
const shopId = await lookupShopId(shop) || session.shopId;
await db.metricEvent.create({
  data: { shop, shopId, eventType: 'TEST' }
});
```

### 3. Migration Script (🔴 Critical)

**Need:** Backfill shopId for existing records

```typescript
// scripts/backfill-shop-id.mjs
// For each model in SHOP_AWARE_MODELS:
//   1. Find records with shop but no shopId
//   2. Lookup shopId from ShopCredential
//   3. Update records with shopId
```

## Testing Setup

### Step 1: Install Vitest

```bash
bun add -d vitest @vitest/ui @vitest/coverage-v8
```

### Step 2: Create Vitest Config

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

### Step 3: Test Database Setup

```typescript
// test/setup.ts
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://...';

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DB_URL } },
});

beforeAll(async () => {
  await testPrisma.$connect();
  // Run migrations
  await testPrisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS test');
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  // Clean test data (or use transactions)
  await testPrisma.shopCredential.deleteMany();
  await testPrisma.metricEvent.deleteMany();
  // ... other models
});
```

### Step 4: Write Critical Tests

#### Test: Multitenant Isolation

```typescript
// test/multitenant-isolation.test.ts
import { describe, it, expect } from 'vitest';
import { testPrisma } from './setup';
import { lookupShopId } from '../app/db.server';

describe('Multitenant Isolation', () => {
  it('should isolate AIStudioImage by shopId', async () => {
    // Create two shops
    const shop1 = await testPrisma.shopCredential.create({
      data: {
        shopDomain: 'shop1.myshopify.com',
        apiKey: 'key1',
        apiSecret: 'secret1',
        appHandle: 'app1',
        appUrl: 'https://app1.com',
        scopes: [],
      },
    });

    const shop2 = await testPrisma.shopCredential.create({
      data: {
        shopDomain: 'shop2.myshopify.com',
        apiKey: 'key2',
        apiSecret: 'secret2',
        appHandle: 'app2',
        appUrl: 'https://app2.com',
        scopes: [],
      },
    });

    // Create images for shop1
    await testPrisma.aIStudioImage.create({
      data: {
        shop: shop1.shopDomain,
        shopId: shop1.id,
        productId: 'prod1',
        url: 'https://image1.com',
        state: 'LIBRARY',
        source: 'AI_GENERATED',
      },
    });

    // Query shop2 should return empty
    const shop2Images = await testPrisma.aIStudioImage.findMany({
      where: { shopId: shop2.id },
    });

    expect(shop2Images).toHaveLength(0);
  });

  it('should prevent cross-shop data access', async () => {
    // Similar test for all SHOP_AWARE_MODELS
  });
});
```

#### Test: Query Filtering

```typescript
// test/query-filtering.test.ts
import { describe, it, expect } from 'vitest';
import { AIStudioMediaService } from '../app/services/ai-studio-media.server';

describe('Query Filtering', () => {
  it('should filter by shopId in getLibraryImages', async () => {
    // Mock admin context
    const mockAdmin = {} as AdminApiContext;
    const service = new AIStudioMediaService(mockAdmin, testPrisma);

    // Create shop and data
    const shop = await createTestShop();
    await createTestImage(shop.id);

    // Query should only return shop's images
    const images = await service.getLibraryImages(
      shop.shopDomain,
      'prod1'
    );

    // Verify query used shopId, not shop domain
    // (Would need to spy on Prisma calls)
  });
});
```

### Step 5: Add Test Scripts

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  }
}
```

## Deployment Steps

### Phase 1: Fix Code (Before Testing)

1. **Audit all queries**
   ```bash
   grep -r "where.*shop:" app/ --include="*.ts" --include="*.tsx"
   grep -r "shop:" app/ --include="*.ts" | grep -E "(create|update|findMany|findFirst)"
   ```

2. **Fix query filtering**
   - Replace `shop: string` with `shopId: string`
   - Resolve shopId from session/request context

3. **Fix create operations**
   - Add shopId resolution before creates
   - Use `lookupShopId()` or `session.shopId`

### Phase 2: Write Tests

4. **Set up Vitest** (see above)

5. **Write isolation tests**
   - Test each model in SHOP_AWARE_MODELS
   - Verify queries filter correctly
   - Verify creates set shopId

6. **Run test suite**
   ```bash
   bun test
   ```

### Phase 3: Migration

7. **Create migration script**
   ```bash
   bun scripts/backfill-shop-id.mjs
   ```

8. **Validate migration**
   ```bash
   # Check for records without shopId
   bun scripts/verify-shop-id.mjs
   ```

### Phase 4: Deploy

9. **Deploy to staging**
   - Run migration
   - Test with multiple shops
   - Verify data isolation

10. **Deploy to production**
    - Run migration during maintenance window
    - Monitor for errors
    - Verify shopId population

## Files Needing Immediate Attention

Based on grep results, these files likely need fixes:

1. `app/services/ai-studio-media.server.ts` - All query methods
2. `app/features/ai-studio/handlers/generation.server.ts` - Create operations
3. `app/features/ai-studio/handlers/library.server.ts` - Create operations
4. `app/routes/app.ai-studio.tsx` - Loader queries
5. `app/routes/app.ab-tests.tsx` - Loader/action queries
6. Any route files using `prisma.*` directly

## Estimated Effort

- **Code fixes:** 4-6 hours
- **Test setup:** 2-3 hours
- **Test writing:** 4-6 hours
- **Migration script:** 2-3 hours
- **Total:** 12-18 hours

## Risk Assessment

**High Risk:**
- Data isolation failures if queries not fixed
- Orphaned records if migration fails
- Performance issues if indexes missing

**Mitigation:**
- Fix queries before deployment
- Test migration on staging first
- Add indexes on shopId fields
- Monitor shopId population rate
