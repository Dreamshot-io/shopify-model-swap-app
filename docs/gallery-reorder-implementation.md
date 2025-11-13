# Gallery Reorder Implementation Document

## Target UI Analysis (from Screenshot)

### Visual Requirements
Based on the provided Shopify-style gallery interface:

1. **Layout Structure**:
   - Large main image preview on left (selected image)
   - Horizontal row of thumbnails on right
   - Thumbnails in rounded square containers
   - "+" button at end for adding more images

2. **Selected State Indicators**:
   - Dark gray background on selected/active thumbnail
   - 6-dot drag handle icon (⋮⋮) visible in top-right corner
   - White checkbox icon in top-left corner
   - Other thumbnails have light borders

3. **Interactive Elements**:
   - Drag handle appears on hover (6 dots pattern)
   - Smooth transitions between positions
   - Visual feedback during drag operation
   - No jarring movements - fluid animations

4. **Key UX Patterns**:
   - Drag handle only visible on hover or when selected
   - Clear visual hierarchy (selected vs unselected)
   - Consistent thumbnail sizing
   - Maintains aspect ratios

## Technical Implementation Plan

### Phase 1: Setup & Dependencies
```bash
# Required packages
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install framer-motion  # For smooth animations
```

### Phase 2: Component Architecture

#### Core Components to Build

1. **`DraggableGalleryThumbnail.tsx`**
   ```tsx
   interface DraggableGalleryThumbnailProps {
     image: ProductImage;
     index: number;
     isSelected: boolean;
     isDragging: boolean;
     onSelect: (image: ProductImage) => void;
   }
   ```
   - Renders thumbnail with conditional drag handle
   - Shows selection checkbox
   - Handles hover state for drag indicator
   - Smooth scale/opacity transitions

2. **`SortableGalleryGrid.tsx`**
   ```tsx
   interface SortableGalleryGridProps {
     images: ProductImage[];
     selectedImage: ProductImage | null;
     onReorder: (images: ProductImage[]) => void;
     onSelect: (image: ProductImage) => void;
   }
   ```
   - Wraps thumbnails in DndContext
   - Manages drag-drop logic
   - Handles position animations
   - Syncs with parent state

3. **`GalleryReorderProvider.tsx`**
   - Context for shared gallery order
   - Syncs product and variant galleries
   - Single source of truth for positions

### Phase 3: Visual Design Specifications

#### Thumbnail Styling
```css
.thumbnail-container {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  position: relative;
  transition: all 0.2s ease;
}

.thumbnail-selected {
  background: #5c5f62;  /* Shopify gray */
  border: 2px solid #5c5f62;
}

.thumbnail-default {
  background: white;
  border: 1px solid #e1e3e5;
}

.drag-handle {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.thumbnail-container:hover .drag-handle {
  opacity: 1;
}
```

#### Drag Handle Icon
```tsx
// 6-dot pattern (2x3 grid)
const DragHandleIcon = () => (
  <svg width="12" height="20" viewBox="0 0 12 20">
    <circle cx="3" cy="3" r="2" fill="#8c9196" />
    <circle cx="9" cy="3" r="2" fill="#8c9196" />
    <circle cx="3" cy="10" r="2" fill="#8c9196" />
    <circle cx="9" cy="10" r="2" fill="#8c9196" />
    <circle cx="3" cy="17" r="2" fill="#8c9196" />
    <circle cx="9" cy="17" r="2" fill="#8c9196" />
  </svg>
);
```

### Phase 4: Drag-Drop Implementation

#### Core Logic
```tsx
const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;

  if (active.id !== over.id) {
    setImages((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);

      const reordered = arrayMove(items, oldIndex, newIndex);

      // Update positions
      return reordered.map((img, idx) => ({
        ...img,
        position: idx
      }));
    });
  }
};
```

#### Animation Configuration
```tsx
const sortableAnimationConfig = {
  duration: 350,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

const thumbnailVariants = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.9, opacity: 0 },
  hover: { scale: 1.05 },
  drag: { scale: 1.1, opacity: 0.8 }
};
```

### Phase 5: State Management Updates

#### Modified ABTestCreationForm State
```tsx
interface GalleryState {
  images: ProductImage[];
  selectedImageId: string | null;
  order: string[];  // Array of image IDs in display order
}

// Unified gallery order
const [galleryOrder, setGalleryOrder] = useState<string[]>([]);

// Sync function
const syncGalleryOrder = (newOrder: string[]) => {
  setGalleryOrder(newOrder);
  // Apply same order to variants
  updateVariantGalleries(newOrder);
};
```

### Phase 6: Shopify API Integration

#### ProductReorderMedia Mutation
```graphql
mutation reorderProductMedia($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) {
    job {
      id
      done
    }
    userErrors {
      field
      message
      code
    }
  }
}
```

#### Implementation in rotation service
```tsx
private static async reorderProductMedia(
  admin: AdminApiContext,
  productId: string,
  orderedMediaIds: string[]
): Promise<void> {
  const moves = orderedMediaIds.map((id, index) => ({
    id: id,
    newPosition: String(index)
  }));

  const response = await admin.graphql(REORDER_MEDIA_MUTATION, {
    variables: {
      id: productId,
      moves: moves
    }
  });

  const result = await response.json();

  if (result.data?.productReorderMedia?.userErrors?.length > 0) {
    console.error('Failed to reorder media:', result.data.productReorderMedia.userErrors);
    throw new Error('Media reordering failed');
  }

  // Optionally poll for job completion
  if (result.data?.productReorderMedia?.job?.id) {
    await this.pollJobCompletion(admin, result.data.productReorderMedia.job.id);
  }
}
```

### Phase 7: Integration Points

#### Files to Modify

1. **`app/features/ai-studio/components/ImageSelector.tsx`**
   - Add DndContext wrapper
   - Replace static grid with sortable container
   - Add hover states for drag handles
   - Implement smooth transitions

2. **`app/features/ai-studio/components/ABTestCreationForm.tsx`**
   - Add unified gallery order state
   - Sync order between product and variants
   - Update submission to preserve order

3. **`app/services/rotation/simple-rotation.server.ts`**
   - Add reorderProductMedia method
   - Call after uploading all images
   - Handle async job polling

4. **`app/features/ai-studio/types.ts`**
   - Add position field to interfaces
   - Add drag-drop type definitions

#### New Files to Create

1. **`app/features/ai-studio/components/DraggableGalleryThumbnail.tsx`**
   - Individual draggable thumbnail component
   - Hover state management
   - Drag handle display

2. **`app/features/ai-studio/components/SortableGalleryGrid.tsx`**
   - Container for sortable thumbnails
   - DnD context provider
   - Reorder logic

3. **`app/features/ai-studio/hooks/useGalleryReorder.ts`**
   - Custom hook for reorder logic
   - Position calculations
   - Animation helpers

4. **`app/features/ai-studio/context/GalleryOrderContext.tsx`**
   - Shared order state
   - Sync mechanisms
   - Provider component

## Testing Strategy

### Unit Tests
```tsx
describe('GalleryReorder', () => {
  it('should update positions when images are reordered');
  it('should sync order between product and variant galleries');
  it('should show drag handle on hover');
  it('should animate position changes smoothly');
});
```

### Integration Tests
```tsx
describe('Shopify API Integration', () => {
  it('should call productReorderMedia after upload');
  it('should handle API errors gracefully');
  it('should maintain order through rotation');
});
```

### E2E Tests
```tsx
describe('Full Reorder Flow', () => {
  it('should allow dragging images to reorder');
  it('should persist order after test creation');
  it('should display images in correct order on product page');
});
```

## Success Metrics

- [ ] Drag-drop works smoothly with 10+ images
- [ ] Animation frame rate stays above 60fps
- [ ] Order syncs correctly across all galleries
- [ ] Shopify API updates media positions
- [ ] No regression in existing functionality
- [ ] Accessibility maintained (keyboard navigation)

## Timeline Estimate

- **Phase 1-2**: 1 hour (setup + basic components)
- **Phase 3-4**: 2 hours (styling + drag-drop logic)
- **Phase 5-6**: 2 hours (state management + API)
- **Phase 7**: 1 hour (testing + polish)

**Total**: ~6 hours

## Notes & Considerations

1. **Performance**: May need virtualization for 50+ images
2. **Mobile**: Touch events handled by @dnd-kit automatically
3. **Accessibility**: Keyboard shortcuts for reordering (Space to pick up, arrows to move)
4. **Browser Support**: All modern browsers, no IE11 needed
5. **Fallback**: If API fails, rely on array insertion order

## Next Steps

1. Get approval on implementation plan
2. Install dependencies
3. Build thumbnail component with drag handle
4. Implement drag-drop logic
5. Add animations
6. Integrate Shopify API
7. Test thoroughly