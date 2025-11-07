# Shopify Variant Association Verification Guide

## Issue
When using `productUpdate` mutation with the `images` parameter, we need to verify that Shopify preserves existing variant associations for media that's already assigned to variants.

## Current Implementation
Our rotation sync (`app/services/ab-test-rotation-sync.server.ts`) uses `productUpdate` with image IDs to rotate galleries. We're NOT explicitly setting `variantIds` because:
1. Shopify's `ProductImageInput` doesn't support `variantIds` in `productUpdate`
2. Variant associations are managed separately via `productVariantAppendMedia`

## How to Verify

### Test 1: Simple Product Rotation
1. Create a product with multiple images
2. Configure a rotation slot with those images
3. Run a rotation swap
4. **Verify**: All images remain accessible on the product page

### Test 2: Variant-Specific Rotation
1. Create a product with variants (e.g., Color: Red, Blue)
2. Assign specific images to each variant using Shopify admin or `productVariantAppendMedia`
3. Configure rotation slot with variant-specific media
4. Run a rotation swap
5. **Verify**:
   - Red variant still shows only Red images
   - Blue variant still shows only Blue images
   - Variant associations are preserved

### Test 3: Query Verification
Use this GraphQL query to check variant associations after rotation:

```graphql
query CheckVariantMedia($productId: ID!) {
  product(id: $productId) {
    variants(first: 10) {
      nodes {
        id
        title
        image {
          id
          url
        }
        media(first: 10) {
          nodes {
            id
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      }
    }
    images(first: 20) {
      nodes {
        id
        url
      }
    }
  }
}
```

## Expected Behavior

**Scenario A: Product-level rotation (no variant associations)**
- ✅ `productUpdate` should work fine
- ✅ All images remain on product
- ✅ No variant-specific associations to preserve

**Scenario B: Variant-specific rotation**
- ⚠️ If `productUpdate` only reorders/replaces product-level images:
  - Variant associations may be preserved (Shopify's default behavior)
  - OR variant associations may be lost (requires reconciliation)

- ✅ If variant associations are lost, we need to:
  1. After `productUpdate`, query current variant media
  2. Compare with expected variant associations from `RotationSlot.controlMedia`/`testMedia`
  3. Use `productVariantAppendMedia` to restore associations

## Current Code Behavior

Looking at `buildImageInput()` in `ab-test-rotation-sync.server.ts`:
- We include `variantIds` in the input (lines 165-167)
- But Shopify's API will likely ignore this field
- **This needs verification**

## Recommended Fix

If variant associations are NOT preserved:

1. After `productUpdate`, fetch current product media
2. For each variant in the rotation slot:
   - Check if media has `variantIds` in our stored data
   - If yes, verify associations exist via GraphQL query
   - If missing, restore using `productVariantAppendMedia`

See `app/features/ai-studio/handlers/variant-media.server.ts` for reference implementation.

## Quick Test Command

```bash
# After rotating a product with variants, check associations:
curl -X POST https://your-shop.myshopify.com/admin/api/2024-01/graphql.json \
  -H "X-Shopify-Access-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { product(id: \"gid://shopify/Product/123\") { variants(first: 5) { nodes { id title media(first: 5) { nodes { id } } } } } }"
  }'
```

