import React from 'react';
import type {
  DragEndEvent,
  DragStartEvent
} from '@dnd-kit/core';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';
import { DraggableGalleryThumbnail } from './DraggableGalleryThumbnail';
import type { ProductImage } from '../types';

interface SortableGalleryGridProps {
  images: ProductImage[];
  selectedImageIds: Set<string>;
  onReorder: (images: ProductImage[]) => void;
  onImageSelect: (image: ProductImage) => void;
  onImageDeselect: (image: ProductImage) => void;
  showSelectionNumbers?: boolean;
  maxSelection?: number;
  className?: string;
}

export const SortableGalleryGrid: React.FC<SortableGalleryGridProps> = ({
  images,
  selectedImageIds,
  onReorder,
  onImageSelect,
  onImageDeselect,
  showSelectionNumbers = true,
  maxSelection,
  className = '',
}) => {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [localImages, setLocalImages] = React.useState(images);

  // Update local images when prop changes
  React.useEffect(() => {
    setLocalImages(images);
  }, [images]);

  // Configure sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum distance before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = localImages.findIndex((img) => img.id === active.id);
      const newIndex = localImages.findIndex((img) => img.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedImages = arrayMove(localImages, oldIndex, newIndex);

        // Update positions
        const imagesWithPositions = reorderedImages.map((img, idx) => ({
          ...img,
          position: idx,
        }));

        setLocalImages(imagesWithPositions);
        onReorder(imagesWithPositions);
      }
    }
  };

  const handleImageClick = (image: ProductImage) => {
    if (selectedImageIds.has(image.id)) {
      onImageDeselect(image);
    } else {
      if (!maxSelection || selectedImageIds.size < maxSelection) {
        onImageSelect(image);
      }
    }
  };

  // Get the selection order number for an image
  const getSelectionNumber = (imageId: string): number => {
    const selectedArray = Array.from(selectedImageIds);
    return selectedArray.indexOf(imageId);
  };

  const activeImage = localImages.find((img) => img.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={localImages.map(img => img.id)}
        strategy={rectSortingStrategy}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
            gap: '12px',
            maxWidth: '100%',
          }}
          className={className}
        >
          <AnimatePresence mode="popLayout">
            {localImages.map((image, index) => (
              <DraggableGalleryThumbnail
                key={image.id}
                image={image}
                index={showSelectionNumbers && selectedImageIds.has(image.id)
                  ? getSelectionNumber(image.id)
                  : index}
                isSelected={selectedImageIds.has(image.id)}
                onSelect={handleImageClick}
                showSelectionNumber={showSelectionNumbers}
              />
            ))}
          </AnimatePresence>

          {/* Add more images button placeholder */}
          {maxSelection && selectedImageIds.size < maxSelection && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '8px',
                border: '2px dashed #e1e3e5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backgroundColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#8c9196';
                e.currentTarget.style.backgroundColor = '#f6f6f7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e1e3e5';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                style={{ color: '#8c9196' }}
              >
                <path
                  d="M12 5V19M5 12H19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </motion.div>
          )}
        </div>
      </SortableContext>

      {/* Drag overlay for smooth dragging visual */}
      <DragOverlay>
        {activeId && activeImage ? (
          <motion.div
            initial={{ scale: 1.05 }}
            animate={{ scale: 1.1 }}
            style={{ opacity: 0.9 }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
                border: '2px solid #008060',
              }}
            >
              <img
                src={activeImage.url || activeImage.originalSource}
                alt={activeImage.altText || ''}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                draggable={false}
              />
            </div>
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
