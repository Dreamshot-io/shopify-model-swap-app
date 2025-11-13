import { useState, useCallback, useEffect } from 'react';
import type { ProductImage } from '../types';

interface UseGalleryReorderProps {
  initialImages?: ProductImage[];
  onOrderChange?: (images: ProductImage[]) => void;
}

interface UseGalleryReorderReturn {
  images: ProductImage[];
  selectedIds: Set<string>;
  reorderImages: (reorderedImages: ProductImage[]) => void;
  selectImage: (image: ProductImage) => void;
  deselectImage: (image: ProductImage) => void;
  toggleImageSelection: (image: ProductImage) => void;
  clearSelection: () => void;
  getOrderedSelection: () => ProductImage[];
  setImages: (images: ProductImage[]) => void;
  syncWithExternalOrder: (orderedIds: string[]) => void;
}

/**
 * Custom hook for managing gallery image ordering and selection
 */
export function useGalleryReorder({
  initialImages = [],
  onOrderChange,
}: UseGalleryReorderProps = {}): UseGalleryReorderReturn {
  const [images, setImages] = useState<ProductImage[]>(() =>
    initialImages.map((img, idx) => ({
      ...img,
      position: img.position ?? idx,
    }))
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Update images when initialImages change
  useEffect(() => {
    if (initialImages.length > 0) {
      setImages(
        initialImages.map((img, idx) => ({
          ...img,
          position: img.position ?? idx,
        }))
      );
    }
  }, [initialImages]);

  /**
   * Reorder images and update their positions
   */
  const reorderImages = useCallback(
    (reorderedImages: ProductImage[]) => {
      const imagesWithPositions = reorderedImages.map((img, idx) => ({
        ...img,
        position: idx,
      }));

      setImages(imagesWithPositions);
      onOrderChange?.(imagesWithPositions);
    },
    [onOrderChange]
  );

  /**
   * Select an image
   */
  const selectImage = useCallback((image: ProductImage) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(image.id);
      return newSet;
    });
  }, []);

  /**
   * Deselect an image
   */
  const deselectImage = useCallback((image: ProductImage) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(image.id);
      return newSet;
    });
  }, []);

  /**
   * Toggle image selection
   */
  const toggleImageSelection = useCallback((image: ProductImage) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(image.id)) {
        newSet.delete(image.id);
      } else {
        newSet.add(image.id);
      }
      return newSet;
    });
  }, []);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Get selected images in their current order
   */
  const getOrderedSelection = useCallback((): ProductImage[] => {
    return images.filter((img) => selectedIds.has(img.id));
  }, [images, selectedIds]);

  /**
   * Set images directly (for external updates)
   */
  const setImagesDirectly = useCallback(
    (newImages: ProductImage[]) => {
      const imagesWithPositions = newImages.map((img, idx) => ({
        ...img,
        position: img.position ?? idx,
      }));
      setImages(imagesWithPositions);
      onOrderChange?.(imagesWithPositions);
    },
    [onOrderChange]
  );

  /**
   * Sync with an external order (e.g., from variant galleries)
   */
  const syncWithExternalOrder = useCallback(
    (orderedIds: string[]) => {
      const imageMap = new Map(images.map((img) => [img.id, img]));
      const reorderedImages: ProductImage[] = [];

      // First, add images in the specified order
      orderedIds.forEach((id, idx) => {
        const image = imageMap.get(id);
        if (image) {
          reorderedImages.push({
            ...image,
            position: idx,
          });
          imageMap.delete(id);
        }
      });

      // Then, add any remaining images that weren't in the ordered list
      let nextPosition = reorderedImages.length;
      imageMap.forEach((image) => {
        reorderedImages.push({
          ...image,
          position: nextPosition++,
        });
      });

      setImages(reorderedImages);
      onOrderChange?.(reorderedImages);
    },
    [images, onOrderChange]
  );

  return {
    images,
    selectedIds,
    reorderImages,
    selectImage,
    deselectImage,
    toggleImageSelection,
    clearSelection,
    getOrderedSelection,
    setImages: setImagesDirectly,
    syncWithExternalOrder,
  };
}