# Variant UI Implementation - Remaining Steps

## Status
- ✅ Backend: Complete
- ✅ ABTestManager: Updated with variants prop
- ✅ app.ai-studio: Passing variants
- ✅ ImageGrid: Component created
- ⏸️ **ABTestCreator: Needs manual updates** (see below)
- ❌ Database: Migration pending

## CRITICAL: Database Migration Required

Before the app will work, run this SQL on your PostgreSQL database:

```sql
ALTER TABLE "ABTest" ADD COLUMN IF NOT EXISTS "variantScope" TEXT DEFAULT 'PRODUCT';
UPDATE "ABTest" SET "variantScope" = 'PRODUCT' WHERE "variantScope" IS NULL;
COMMENT ON COLUMN "ABTest"."variantScope" IS 'Scope of the test: PRODUCT (all variants) or VARIANT (per-variant)';
```

This file is saved at: `prisma/migrations/manual_add_variant_scope.sql`

## AB Test Creator Changes Needed

The file `app/features/ab-testing/components/ABTestCreator.tsx` needs the following changes:

### 1. Update imports (Line 2-15)

ADD these to the imports:
```typescript
import { Checkbox } from "@shopify/polaris";  // Add to existing Polaris imports
import { ImageGrid } from './ImageGrid';       // Add after type imports
```

### 2. Update Props Interface (Line 17-21)

CHANGE:
```typescript
interface ABTestCreatorProps {
  productId: string;
  availableImages: string[];
  onTestCreate: (request: ABTestCreateRequest) => void;
  isCreating?: boolean;
}
```

TO:
```typescript
interface ABTestCreatorProps {
  productId: string;
  availableImages: string[];
  variants?: any[];  // ADD THIS LINE
  onTestCreate: (request: ABTestCreateRequest) => void;
  isCreating?: boolean;
}
```

### 3. Update Function Signature (Line 24-29)

CHANGE:
```typescript
export function ABTestCreator({
  productId,
  availableImages,
  onTestCreate,
  isCreating = false,
}: ABTestCreatorProps) {
```

TO:
```typescript
export function ABTestCreator({
  productId,
  availableImages,
  variants,  // ADD THIS LINE
  onTestCreate,
  isCreating = false,
}: ABTestCreatorProps) {
```

### 4. Add New State Variables (After line 38, after selectionCounter)

ADD these state variables:
```typescript
// New state for variant-specific tests
const [testScope, setTestScope] = useState<'PRODUCT' | 'VARIANT'>('PRODUCT');
const [variantTests, setVariantTests] = useState<
  Map<
    string,
    {
      enabled: boolean;
      variantAImages: Map<string, number>;
      variantBImages: Map<string, number>;
    }
  >
>(new Map());

// Determine if we should show variant options
const hasMultipleVariants = variants && variants.length > 1;
const showVariantOptions =
  hasMultipleVariants || (variants && variants.length === 1 && variants[0].title !== 'Default Title');
```

### 5. Add Helper Functions (After handleImageToggle function, before handleSubmit)

ADD these functions:
```typescript
// Format variant title for display
const formatVariantTitle = (variant: any): string => {
  if (variant.title === 'Default Title') {
    return 'Default Variant';
  }
  const options = variant.selectedOptions?.map((opt: any) => opt.value).join(' / ');
  return options || variant.title;
};

// Toggle variant test on/off
const handleVariantToggle = (variantId: string, enabled: boolean) => {
  setVariantTests(prev => {
    const newMap = new Map(prev);
    const current = newMap.get(variantId) || {
      enabled: false,
      variantAImages: new Map(),
      variantBImages: new Map(),
    };
    newMap.set(variantId, { ...current, enabled });
    return newMap;
  });
};

// Toggle image selection for a specific variant
const handleVariantImageToggle = (variantId: string, testVariant: 'A' | 'B', imageUrl: string) => {
  setVariantTests(prev => {
    const newMap = new Map(prev);
    const current = newMap.get(variantId) || {
      enabled: false,
      variantAImages: new Map(),
      variantBImages: new Map(),
    };

    const imageMap = testVariant === 'A' ? current.variantAImages : current.variantBImages;

    const newImageMap = new Map(imageMap);
    if (newImageMap.has(imageUrl)) {
      newImageMap.delete(imageUrl);
    } else {
      newImageMap.set(imageUrl, selectionCounter);
      setSelectionCounter(c => c + 1);
    }

    newMap.set(variantId, {
      ...current,
      [testVariant === 'A' ? 'variantAImages' : 'variantBImages']: newImageMap,
    });

    return newMap;
  });
};
```

### 6. Replace handleSubmit Function (ENTIRE function)

REPLACE the entire handleSubmit function with:
```typescript
const handleSubmit = () => {
  if (!testName) return;

  if (testScope === 'PRODUCT') {
    // Existing product-wide submission logic
    if (variantAImages.size === 0 || variantBImages.size === 0) {
      alert('Please select images for both Variant A and Variant B');
      return;
    }

    const sortedAImages = Array.from(variantAImages.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([url]) => url)
      .slice(0, 6);

    const filteredBEntries = Array.from(variantBImages.entries())
      .sort((a, b) => a[1] - b[1])
      .filter(([url]) => !sortedAImages.includes(url));

    const sortedBImages = filteredBEntries.map(([url]) => url).slice(0, 6);

    if (sortedAImages.length === 0 || sortedBImages.length === 0) {
      alert('Each variant must contain at least one unique image (max 6 per variant)');
      return;
    }

    onTestCreate({
      name: testName,
      productId,
      variantScope: 'PRODUCT',
      variantAImages: sortedAImages,
      variantBImages: sortedBImages,
      trafficSplit: 50,
    });
  } else {
    // New variant-specific submission
    const enabledVariantTests = Array.from(variantTests.entries())
      .filter(([_, test]) => test.enabled)
      .map(([variantId, test]) => ({
        shopifyVariantId: variantId,
        variantAImages: Array.from(test.variantAImages.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([url]) => url)
          .slice(0, 6),
        variantBImages: Array.from(test.variantBImages.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([url]) => url)
          .slice(0, 6),
      }));

    if (enabledVariantTests.length === 0) {
      alert('Please enable at least one variant for testing');
      return;
    }

    // Check if each enabled variant has images
    const invalidVariants = enabledVariantTests.filter(
      vt => vt.variantAImages.length === 0 || vt.variantBImages.length === 0,
    );

    if (invalidVariants.length > 0) {
      alert('Each enabled variant must have at least one image in both A and B sets');
      return;
    }

    onTestCreate({
      name: testName,
      productId,
      variantScope: 'VARIANT',
      variantTests: enabledVariantTests,
      trafficSplit: 50,
    });
  }
};
```

### 7. Add Test Scope Selector (In the FormLayout section, after Test Name field)

After the TextField for "Test Name", ADD:
```typescript
{showVariantOptions && (
  <Select
    label='Test Scope'
    options={[
      { label: 'All Variants (same test for all)', value: 'PRODUCT' },
      { label: 'Per Variant (different tests per variant)', value: 'VARIANT' },
    ]}
    value={testScope}
    onChange={value => setTestScope(value as 'PRODUCT' | 'VARIANT')}
    helpText={
      testScope === 'PRODUCT'
        ? 'All variants will show the same A/B test images'
        : 'Each variant can have its own A/B test images'
    }
  />
)}
```

### 8. Wrap Image Selection Grid (The big section starting with "Select Images")

FIND the section that starts with:
```typescript
<BlockStack gap='300'>
  <InlineStack align='space-between' wrap={false}>
    <Text as='h3' variant='headingMd'>
      Select Images
    </Text>
```

And ENDS with:
```typescript
    <Text variant='bodySm' tone='subdued' alignment='center'>
      Click images to add them to...
    </Text>
  </BlockStack>
</Grid>
```

WRAP this entire section with a conditional:
```typescript
{testScope === 'PRODUCT' ? (
  // EXISTING IMAGE SELECTION CODE HERE
) : (
  // NEW VARIANT-SPECIFIC UI - SEE NEXT SECTION
)}
```

### 9. Add Variant-Specific UI (In the else part of the conditional above)

In the `) : (` part, ADD:
```typescript
<BlockStack gap='400'>
  <Text as='h3' variant='headingMd'>
    Select Images for Each Variant
  </Text>
  <Text variant='bodySm' tone='subdued'>
    Choose which variants to test and select images for each
  </Text>

  {variants?.map(variant => {
    const variantTest = variantTests.get(variant.id) || {
      enabled: false,
      variantAImages: new Map(),
      variantBImages: new Map(),
    };

    return (
      <Card key={variant.id} subdued>
        <BlockStack gap='300'>
          <InlineStack align='space-between' blockAlign='center'>
            <Text variant='headingMd'>{formatVariantTitle(variant)}</Text>
            <Checkbox
              label='Enable A/B Test'
              checked={variantTest.enabled}
              onChange={checked => handleVariantToggle(variant.id, checked)}
            />
          </InlineStack>

          {variantTest.enabled && (
            <>
              <Divider />
              <Grid columns={{ xs: 1, md: 2 }}>
                <BlockStack gap='200'>
                  <Text as='h4' variant='headingSm'>
                    Variant A Images
                  </Text>
                  <Text variant='bodySm' tone='subdued'>
                    {variantTest.variantAImages.size} selected
                  </Text>
                  <ImageGrid
                    images={availableImages}
                    selectedImages={variantTest.variantAImages}
                    onToggle={url => handleVariantImageToggle(variant.id, 'A', url)}
                    variant='A'
                  />
                </BlockStack>

                <BlockStack gap='200'>
                  <Text as='h4' variant='headingSm'>
                    Variant B Images
                  </Text>
                  <Text variant='bodySm' tone='subdued'>
                    {variantTest.variantBImages.size} selected
                  </Text>
                  <ImageGrid
                    images={availableImages}
                    selectedImages={variantTest.variantBImages}
                    onToggle={url => handleVariantImageToggle(variant.id, 'B', url)}
                    variant='B'
                  />
                </BlockStack>
              </Grid>
            </>
          )}
        </BlockStack>
      </Card>
    );
  })}
</BlockStack>
```

## Testing After Implementation

1. Build the app: `npm run build`
2. Test with simple product (should show existing UI)
3. Test with multi-variant product (should show scope selector)
4. Select "Per Variant" scope (should show variant list)
5. Enable some variants and select images
6. Create test and verify data structure

## Files Modified Summary

- ✅ `app/routes/app.ai-studio.tsx` - Passes variants
- ✅ `app/features/ab-testing/components/ABTestManager.tsx` - Accepts variants
- ✅ `app/features/ab-testing/components/ImageGrid.tsx` - New component
- ⏸️ `app/features/ab-testing/components/ABTestCreator.tsx` - NEEDS MANUAL UPDATES (see above)
- ✅ `app/routes/variant.$productId.tsx` - Handles variant-specific tests (done earlier)
- ✅ `app/routes/app.ab-tests.tsx` - Handles variant test creation (done earlier)
- ✅ `public/ab-test-script.js` - Variant detection (done earlier)

## Once Complete

The variant-specific image selection UI will be fully functional!
