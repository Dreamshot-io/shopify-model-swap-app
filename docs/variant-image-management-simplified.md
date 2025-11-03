# Simplified Variant Image Management Implementation

## Overview
Enable variant-level A/B testing where each variant can optionally have its own A/B test configuration. Simple products (with only default variant) continue to work as-is.

## Requirements Summary (Based on Clarifications)

1. **Traffic Split**: Fixed 50/50 split for all tests (no configuration needed)
2. **UI**: All variants shown on same page (optimize later if needed)  
3. **Inheritance**: Variant tests only override images, all other settings inherited from product
4. **Mixed Testing**: Some variants can have A/B tests, others don't need to (e.g., "gray" has A/B test, "blue" doesn't)
5. **Analytics**: Combined view across all variants
6. **Migration**: Existing tests assigned to default variant (products always have at least one)

## Database Changes

No schema changes needed! Current schema already supports this:
- `ABTest.variantScope` - Set to "VARIANT" for variant-level tests
- `ABTestVariant.shopifyVariantId` - Links test images to specific product variant
- `ABTestEvent.variantId` - Tracks which variant was involved in event

## Implementation Plan

### Phase 1: Backend Updates (2-3 days)

#### 1.1 Update AB Test Creation
**File**: `app/routes/app.ab-tests.tsx`

```typescript
// Modified ABTestCreateRequest type
interface ABTestCreateRequest {
  name: string;
  productId: string;
  variantScope: "PRODUCT" | "VARIANT";
  variantTests?: Array<{
    shopifyVariantId: string;
    variantAImages: string[];
    variantBImages: string[];
  }>;
  // For product-wide tests (backward compatibility)
  variantAImages?: string[];
  variantBImages?: string[];
}
```

#### 1.2 Update Variant Endpoint
**File**: `app/routes/variant.$productId.tsx`

Modify to:
1. Accept optional `variantId` query parameter
2. Check for variant-specific test first
3. Fall back to product-wide test if no variant test exists
4. Return appropriate images based on variant

```typescript
// Modified endpoint logic
const variantId = url.searchParams.get('variantId');

// Try variant-specific test first
if (variantId) {
  const variantTest = await db.aBTest.findFirst({
    where: {
      productId,
      shop: session.shop,
      status: "RUNNING",
      variantScope: "VARIANT",
      variants: {
        some: { shopifyVariantId: variantId }
      }
    },
    include: { variants: true }
  });
  
  if (variantTest) {
    // Use variant-specific images
    return handleVariantTest(variantTest, sessionId);
  }
}

// Fall back to product-wide test
const productTest = await db.aBTest.findFirst({
  where: {
    productId,
    shop: session.shop,
    status: "RUNNING",
    variantScope: "PRODUCT"
  },
  include: { variants: true }
});
```

### Phase 2: Frontend Updates (2 days)

#### 2.1 Variant Change Detection
**File**: `public/ab-test-script.js`

Add lightweight variant detection:

```javascript
// Detect current variant from multiple sources
function getCurrentVariantId() {
  // 1. Check URL parameter
  const urlVariant = new URLSearchParams(window.location.search).get('variant');
  if (urlVariant) return urlVariant;
  
  // 2. Check form input
  const formVariant = document.querySelector('form[action*="/cart/add"] [name="id"]')?.value;
  if (formVariant) return formVariant;
  
  // 3. For simple products, return null (will use product-wide test)
  return null;
}

// Watch for variant changes
function watchVariantChanges(callback) {
  let currentVariant = getCurrentVariantId();
  
  // Monitor URL changes
  const checkVariant = () => {
    const newVariant = getCurrentVariantId();
    if (newVariant !== currentVariant) {
      currentVariant = newVariant;
      callback(newVariant);
    }
  };
  
  // Check periodically (simple approach)
  setInterval(checkVariant, 500);
  
  // Also listen for form changes
  document.addEventListener('change', (e) => {
    if (e.target.name === 'id' || e.target.matches('[data-variant-selector]')) {
      setTimeout(checkVariant, 100);
    }
  });
}

// Update fetch call to include variant
async function fetchVariantImages(productId, variantId) {
  const sessionId = getSessionId();
  let url = `/apps/model-swap/variant/${encodeURIComponent(productId)}?session=${sessionId}`;
  
  if (variantId) {
    url += `&variantId=${variantId}`;
  }
  
  const response = await fetch(url);
  return response.json();
}
```

### Phase 3: UI Updates (2-3 days)

#### 3.1 AB Test Creator Enhancement
**File**: `app/features/ab-testing/components/ABTestCreator.tsx`

Add variant selection UI:

```typescript
export function ABTestCreator({ product, variants, onTestCreate }) {
  const [testScope, setTestScope] = useState<"PRODUCT" | "VARIANT">("PRODUCT");
  const [variantTests, setVariantTests] = useState(new Map());
  
  // For simple products (hasOnlyDefaultVariant), only show product-wide option
  const showVariantOptions = variants.length > 1;
  
  return (
    <Card>
      {/* Scope Selection - only show if product has variants */}
      {showVariantOptions && (
        <RadioButton
          label="Test Scope"
          options={[
            { value: "PRODUCT", label: "All Variants (same test for all)" },
            { value: "VARIANT", label: "Per Variant (different tests per variant)" }
          ]}
          selected={testScope}
          onChange={setTestScope}
        />
      )}
      
      {/* Product-wide test UI (existing) */}
      {testScope === "PRODUCT" && (
        <ExistingImageSelector />
      )}
      
      {/* Per-variant test UI */}
      {testScope === "VARIANT" && (
        <BlockStack gap="400">
          {variants.map(variant => (
            <Card key={variant.id} subdued>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">
                    {variant.title === "Default Title" ? product.title : variant.title}
                  </Text>
                  <Checkbox
                    label="Enable A/B test"
                    checked={variantTests.has(variant.id)}
                    onChange={(checked) => toggleVariantTest(variant.id, checked)}
                  />
                </InlineStack>
                
                {variantTests.has(variant.id) && (
                  <VariantImageSelector
                    variant={variant}
                    onImagesSelect={(a, b) => updateVariantTest(variant.id, a, b)}
                  />
                )}
              </BlockStack>
            </Card>
          ))}
        </BlockStack>
      )}
      
      <Text variant="bodySm" tone="subdued">
        Traffic split: 50/50 for all tests
      </Text>
    </Card>
  );
}
```

### Phase 4: Migration (1 day)

#### 4.1 Database Migration Script
**File**: `scripts/migrate-to-variant-tests.ts`

```typescript
// Assign existing tests to default variant
async function migrateExistingTests() {
  const tests = await db.aBTest.findMany({
    where: { variantScope: null },
    include: { variants: true }
  });
  
  for (const test of tests) {
    // Get product's default variant
    const product = await admin.graphql(`
      query {
        product(id: "${test.productId}") {
          variants(first: 1) {
            nodes { id }
          }
        }
      }
    `);
    
    const defaultVariantId = product.data.product.variants.nodes[0]?.id;
    
    // Update test
    await db.aBTest.update({
      where: { id: test.id },
      data: {
        variantScope: "PRODUCT",
        variants: {
          update: test.variants.map(v => ({
            where: { id: v.id },
            data: { shopifyVariantId: defaultVariantId }
          }))
        }
      }
    });
  }
}
```

## File Changes Summary

### Backend (5 files)
1. ✏️ `app/routes/variant.$productId.tsx` - Add variant-specific test logic
2. ✏️ `app/routes/app.ab-tests.tsx` - Support variant test creation
3. ✏️ `app/features/ab-testing/types.ts` - Add variant test types
4. ✏️ `app/features/ab-testing/components/ABTestCreator.tsx` - Variant UI
5. ✏️ `app/features/ab-testing/components/ABTestCard.tsx` - Show variant info

### Frontend (1 file)
1. ✏️ `public/ab-test-script.js` - Detect variant changes & fetch variant images

### New Files (0)
None needed! Using existing structure.

## Testing Checklist

- [ ] Simple product (1 variant) - works as before
- [ ] Product with variants - can create variant-specific tests
- [ ] Mixed mode - some variants with tests, some without
- [ ] Variant switching - images update correctly
- [ ] Analytics - tracks variant in events
- [ ] Migration - existing tests continue working

## Example Scenarios

### Scenario 1: T-Shirt with Colors
- Product: "Classic T-Shirt"
- Variants: Red, Blue, Gray
- Setup:
  - Red: No A/B test (shows same images to all)
  - Blue: No A/B test
  - Gray: A/B test with 2 different image sets
- Result: When customer selects Gray, they see A or B images (50/50). Other colors show default images.

### Scenario 2: Simple Product
- Product: "Digital Download"
- Variants: Default (only one)
- Setup: Product-wide A/B test
- Result: Works exactly as current system

## Benefits of This Approach

1. **Minimal Changes**: Reuses existing database schema
2. **Backward Compatible**: Existing tests continue working
3. **Flexible**: Mix of tested/untested variants
4. **Simple**: Fixed 50/50 split, no complex configuration
5. **Performant**: Only fetches images when variant changes

## Next Steps

1. Implement backend changes (Phase 1)
2. Test with existing product tests
3. Add frontend variant detection (Phase 2)
4. Update UI for variant test creation (Phase 3)
5. Migrate existing tests (Phase 4)
6. Deploy and monitor
