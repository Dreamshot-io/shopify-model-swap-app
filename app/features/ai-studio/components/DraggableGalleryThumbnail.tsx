import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { Thumbnail } from '@shopify/polaris';
import type { ProductImage } from '../types';

interface DraggableGalleryThumbnailProps {
  image: ProductImage;
  index: number;
  isSelected: boolean;
  isDragging?: boolean;
  onSelect: (image: ProductImage) => void;
  showSelectionNumber?: boolean;
}

// 6-dot drag handle icon matching Shopify style
const DragHandleIcon: React.FC = () => (
  <svg
    width="12"
    height="20"
    viewBox="0 0 12 20"
    fill="none"
    style={{ cursor: 'grab' }}
  >
    <circle cx="3" cy="3" r="1.5" fill="#8c9196" />
    <circle cx="9" cy="3" r="1.5" fill="#8c9196" />
    <circle cx="3" cy="10" r="1.5" fill="#8c9196" />
    <circle cx="9" cy="10" r="1.5" fill="#8c9196" />
    <circle cx="3" cy="17" r="1.5" fill="#8c9196" />
    <circle cx="9" cy="17" r="1.5" fill="#8c9196" />
  </svg>
);

// Checkmark icon for selected state
const CheckmarkIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect width="16" height="16" rx="4" fill="white" />
    <path
      d="M4.5 8L6.5 10L11.5 5"
      stroke="#008060"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Add spin animation keyframes
const spinAnimation = `
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export const DraggableGalleryThumbnail: React.FC<DraggableGalleryThumbnailProps> = ({
  image,
  index,
  isSelected,
  isDragging = false,
  onSelect,
  showSelectionNumber = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Inject animation styles
  React.useEffect(() => {
    const styleId = 'draggable-gallery-spin-animation';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = spinAnimation;
      document.head.appendChild(style);
    }
  }, []);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: image.id,
    disabled: false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger selection when dragging
    if (!isSortableDragging) {
      onSelect(image);
    }
  };

  const thumbnailVariants = {
    initial: { scale: 0.9, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    hover: { scale: 1.02 },
    drag: { scale: 1.05, opacity: 0.9 },
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={{
        ...style,
        width: '80px',
        height: '80px',
      }}
      variants={thumbnailVariants}
      initial="initial"
      animate={isSortableDragging ? "drag" : "animate"}
      whileHover="hover"
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        onClick={handleClick}
        style={{
          position: 'relative',
          width: '80px',
          height: '80px',
          cursor: 'pointer',
          borderRadius: '8px',
          overflow: 'hidden',
          border: isSelected ? '2px solid #008060' : '1px solid #e1e3e5',
          backgroundColor: isSelected ? '#f6f6f7' : 'white',
          boxShadow: isSelected ? '0 0 0 1px #008060' : 'none',
          transition: 'all 0.2s ease',
          opacity: isSortableDragging ? 0.5 : 1,
        }}
      >
        {/* Using Polaris Thumbnail for consistent sizing */}
        <Thumbnail
          source={image.url || image.originalSource || ''}
          alt={image.altText || `Image ${index + 1}`}
          size="large"
        />

        {/* Selected overlay */}
        {isSelected && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 128, 96, 0.1)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Selection checkmark - no numbers */}
        {isSelected && (
          <div
            style={{
              position: 'absolute',
              top: '4px',
              left: '4px',
              width: '20px',
              height: '20px',
              backgroundColor: '#008060',
              color: 'white',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 'bold',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              zIndex: 2,
            }}
          >
            ✓
          </div>
        )}

        {/* Drag handle - only show on hover or when selected */}
        <motion.div
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            touchAction: 'none',
            zIndex: 3,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: (isHovered || isSelected) ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            style={{
              padding: '2px',
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <DragHandleIcon />
          </div>
        </motion.div>

        {/* Loading state */}
        {isDragging && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '16px',
                height: '16px',
                border: '2px solid #666',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
};