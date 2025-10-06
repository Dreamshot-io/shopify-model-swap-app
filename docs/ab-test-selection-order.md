# A/B Test Image Selection Order Feature

## Overview

This feature preserves the order in which images are selected for A/B test variants, ensuring that images are displayed and stored in their selection order rather than their original grid order.

## Implementation Details

### 1. State Management Change

**Before:** Used simple arrays to store selected images
```typescript
const [variantAImages, setVariantAImages] = useState<string[]>([]);
const [variantBImages, setVariantBImages] = useState<string[]>([]);
```

**After:** Using Maps to track selection order
```typescript
const [variantAImages, setVariantAImages] = useState<Map<string, number>>(new Map());
const [variantBImages, setVariantBImages] = useState<Map<string, number>>(new Map());
const [selectionCounter, setSelectionCounter] = useState(0);
```

The Map structure stores:
- **Key:** Image URL
- **Value:** Selection order number (incrementing counter)

### 2. Selection Logic

When an image is selected:
1. It receives a unique order number from `selectionCounter`
2. The counter increments for the next selection
3. If deselected and reselected, it gets a new order number at the end

```typescript
const handleImageToggle = (imageUrl: string, variant: "A" | "B") => {
  if (variant === "A") {
    setVariantAImages(prev => {
      const newMap = new Map(prev);
      if (newMap.has(imageUrl)) {
        newMap.delete(imageUrl);
      } else {
        newMap.set(imageUrl, selectionCounter);
        setSelectionCounter(c => c + 1);
      }
      return newMap;
    });
    // Remove from B if it exists there
    setVariantBImages(prev => {
      const newMap = new Map(prev);
      newMap.delete(imageUrl);
      return newMap;
    });
  }
  // Similar logic for variant B...
};
```

### 3. Visual Indicators

Each selected image displays:

1. **Selection Badge:** Shows variant letter and selection order
   - Format: "A #1", "B #2", etc.
   - Color: Green for Variant A, Blue for Variant B
   - Position: Top-left corner

2. **Visual States:**
   - **Selected for current variant:** Green border + checkmark + badge
   - **Selected for other variant:** Orange border + light orange background + badge
   - **Not selected:** Grey border

3. **Style Details:**
```css
/* Selected for current variant */
border: 3px solid #008060;
background: #F0FAF7;

/* Selected for other variant */
border: 2px solid #FFA500;
background: #FFF5E6;

/* Badge styling */
Variant A: background #008060 (green)
Variant B: background #0066CC (blue)
```

### 4. Submission Process

When creating the A/B test:
1. Maps are converted to arrays
2. Arrays are sorted by selection order
3. Images are sent to backend in selection order

```typescript
const handleSubmit = () => {
  // Convert Maps to sorted arrays based on selection order
  const sortedAImages = Array.from(variantAImages.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([url]) => url);

  const sortedBImages = Array.from(variantBImages.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([url]) => url);

  onTestCreate({
    name: testName,
    productId,
    variantAImages: sortedAImages,
    variantBImages: sortedBImages,
    trafficSplit: parseInt(trafficSplit),
  });
};
```

## User Experience

### Selection Flow

1. **Select Images:** Click images in desired order
2. **See Order:** Badge shows selection position (A #1, A #2, etc.)
3. **Switch Variants:** Use variant buttons to select images for each variant
4. **Visual Feedback:**
   - Current variant selections: Green with checkmark
   - Other variant selections: Orange highlighting
   - Selection order always visible

### Example Scenario

1. User selects for Variant A: Image3, Image1, Image4
   - Display shows: Image3 (A #1), Image1 (A #2), Image4 (A #3)

2. User deselects Image1, then reselects it
   - New order: Image3 (A #1), Image4 (A #2), Image1 (A #3)

3. When test is created, images are stored in selection order
   - Database: ["image3.jpg", "image4.jpg", "image1.jpg"]

## Benefits

1. **Predictable Order:** Images appear in the order user selected them
2. **Visual Clarity:** Badges clearly show which images belong to which variant
3. **Order Preservation:** Selection order is maintained through the entire workflow
4. **User Control:** Users can intentionally order images for testing

## Technical Benefits

1. **No Backend Changes Required:** Works with existing API
2. **Backward Compatible:** Outputs same array format as before
3. **Clear State Management:** Map structure makes order tracking explicit
4. **Performance:** O(1) lookups for selection state

## Testing

The implementation includes comprehensive test coverage for:
- Order preservation during selection
- Order maintenance when toggling selections
- Correct sorting before submission
- Visual badge display
- Variant switching behavior

## Files Modified

- `/app/features/ab-testing/components/ABTestCreator.tsx` - Main implementation
- `/app/features/ab-testing/components/ABTestCreator.test.tsx` - Test suite

## Future Enhancements

Possible improvements for future iterations:
1. Drag-and-drop reordering of selected images
2. Bulk selection tools (select all, clear all)
3. Selection history/undo functionality
4. Keyboard shortcuts for faster selection