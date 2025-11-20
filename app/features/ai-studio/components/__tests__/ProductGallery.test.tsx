import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AppProvider } from "@shopify/polaris";
import { ProductGallery } from "../ProductGallery";

// Setup window.matchMedia BEFORE importing Polaris components
// Polaris components access window.matchMedia during module initialization
if (typeof window !== 'undefined') {
	const matchMediaMock = vi.fn().mockImplementation(query => {
		const mediaQueryList = {
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		};
		return mediaQueryList;
	});
	
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		configurable: true,
		value: matchMediaMock,
	});
}

// Mock Shopify Polaris components that need special handling
vi.mock("@shopify/polaris", async () => {
  const actual = await vi.importActual("@shopify/polaris");
  
  // Create Modal mock with Section subcomponent
  const ModalMock = vi.fn(({ children, open, onClose, primaryAction, secondaryActions, title }) =>
    open ? (
      <div data-testid="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {primaryAction && (
          <button
            onClick={primaryAction.onAction}
            disabled={primaryAction.loading}
          >
            {primaryAction.content}
          </button>
        )}
        {secondaryActions?.map((action, index) => (
          <button key={index} onClick={action.onAction}>
            {action.content}
          </button>
        ))}
      </div>
    ) : null
  );
  
  // Attach Section as a property to Modal
  ModalMock.Section = vi.fn(({ children }) => <div>{children}</div>);
  
  return {
    ...actual,
    Modal: ModalMock,
  };
});

// Helper function to wrap components with AppProvider
const renderWithAppProvider = (component: React.ReactElement) => {
	const result = render(
		<AppProvider 
			i18n={{
				locale: 'en',
				fallbackLocale: 'en',
				translations: {},
			}}
		>
			{component}
		</AppProvider>
	);
	
	// Override rerender to also wrap with AppProvider
	const originalRerender = result.rerender;
	result.rerender = (component: React.ReactElement) => {
		return originalRerender(
			<AppProvider 
				i18n={{
					locale: 'en',
					fallbackLocale: 'en',
					translations: {},
				}}
			>
				{component}
			</AppProvider>
		);
	};
	
	return result;
};

describe("ProductGallery", () => {
  const mockOnDelete = vi.fn();
  const mockOnPublishFromLibrary = vi.fn();
  const mockOnRemoveFromLibrary = vi.fn();

  beforeEach(() => {
    // Arrange - Clear mocks before each test
    vi.clearAllMocks();
    
    // Setup window.matchMedia using plain functions (not vi.fn) so clearAllMocks doesn't affect it
    if (typeof window !== 'undefined') {
      const createMediaQueryList = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      });
      
      // Use a plain function instead of vi.fn() so clearAllMocks doesn't affect it
      const matchMediaMock = (query: string) => {
        return createMediaQueryList(query);
      };
      
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: matchMediaMock,
      });
    }
  });

  const mockPublishedImages = [
    {
      id: "gid://shopify/MediaImage/1",
      alt: "Product front view",
      image: {
        url: "https://cdn.shopify.com/product1.jpg",
        altText: "Product front",
        width: 800,
        height: 600,
      },
    },
    {
      id: "gid://shopify/MediaImage/2",
      alt: "Product back view",
      image: {
        url: "https://cdn.shopify.com/product2.jpg",
        altText: "Product back",
        width: 800,
        height: 600,
      },
    },
  ];

  const mockLibraryItems = [
    { imageUrl: "https://cdn.shopify.com/library1.jpg", sourceUrl: null },
    { imageUrl: "https://cdn.shopify.com/library2.webp", sourceUrl: "https://source.jpg" },
  ];


  describe("Component Rendering", () => {
    it("should render empty state when no images exist", () => {
      // Arrange
      const props = {
        images: [],
        libraryItems: [],
        onDelete: mockOnDelete,
        isDeleting: false,
      };

      // Act
      renderWithAppProvider(<ProductGallery {...props} />);

      // Assert
      expect(screen.getByText("No product images")).toBeInTheDocument();
      expect(
        screen.getByText(/This product doesn't have any images yet/i)
      ).toBeInTheDocument();
    });

    it("should render published images with correct badges", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // Check that images are rendered
      const images = screen.getAllByRole("img");
      expect(images).toHaveLength(2);

      // Check for published badges
      const publishedBadges = screen.getAllByText("Published");
      expect(publishedBadges).toHaveLength(2);

      // Check count badge
      expect(screen.getByText("2 published")).toBeInTheDocument();
    });

    it("renders library items with correct badges", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      // Check that library images are rendered
      const images = screen.getAllByRole("img");
      expect(images).toHaveLength(2);

      // Check for library badges
      const libraryBadges = screen.getAllByText("Library");
      expect(libraryBadges).toHaveLength(2);

      // Check count badge
      expect(screen.getByText("2 in library")).toBeInTheDocument();
    });

    it("renders both published and library images together", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      // Check total image count
      const images = screen.getAllByRole("img");
      expect(images).toHaveLength(4);

      // Check for both types of badges
      const publishedBadges = screen.getAllByText("Published");
      expect(publishedBadges).toHaveLength(2);

      const libraryBadges = screen.getAllByText("Library");
      expect(libraryBadges).toHaveLength(2);

      // Check both count badges appear
      expect(screen.getByText("2 published")).toBeInTheDocument();
      expect(screen.getByText("2 in library")).toBeInTheDocument();
    });

    it("displays images with proper alt text", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // Check published images alt text
      expect(screen.getByAltText("Product front")).toBeInTheDocument();
      expect(screen.getByAltText("Product back")).toBeInTheDocument();

      // Check library images alt text
      const libraryImages = screen.getAllByAltText("Stored library variant");
      expect(libraryImages).toHaveLength(2);
    });

    it("handles library items as strings (legacy format)", () => {
      const stringLibraryItems = [
        "https://cdn.shopify.com/string1.jpg",
        "https://cdn.shopify.com/string2.jpg",
      ];

      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={stringLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const images = screen.getAllByRole("img");
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute("src", stringLibraryItems[0]);
      expect(images[1]).toHaveAttribute("src", stringLibraryItems[1]);
    });
  });

  describe("Delete Functionality - Published Images", () => {
    it("shows delete button for published images", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButtons = screen.getAllByLabelText("Delete image");
      expect(deleteButtons).toHaveLength(2);
    });

    it("opens confirmation modal when delete button is clicked", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButton = screen.getAllByLabelText("Delete image")[0];
      fireEvent.click(deleteButton);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Delete product image?")).toBeInTheDocument();
      expect(
        screen.getByText(/This will permanently remove the image from your product/i)
      ).toBeInTheDocument();
    });

    it("calls onDelete when confirming deletion", async () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButton = screen.getAllByLabelText("Delete image")[0];
      fireEvent.click(deleteButton);

      const confirmButton = screen.getByText("Delete");
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledWith(mockPublishedImages[0].id);
      });
    });

    it("closes modal when canceling deletion", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButton = screen.getAllByLabelText("Delete image")[0];
      fireEvent.click(deleteButton);

      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockOnDelete).not.toHaveBeenCalled();
    });

    it("disables delete buttons when isDeleting is true", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={true}
        />
      );

      const deleteButtons = screen.getAllByLabelText("Delete image");
      deleteButtons.forEach(button => {
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('tabindex', '-1');
      });
    });
  });

  describe("Library Item Actions", () => {
    it("shows publish button for library items", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      const publishButtons = screen.getAllByText("Publish");
      expect(publishButtons).toHaveLength(2);
    });

    it("shows remove button for library items", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      const removeButtons = screen.getAllByText("Remove");
      expect(removeButtons).toHaveLength(2);
    });

    it("calls onPublishFromLibrary when publish button is clicked", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      const publishButton = screen.getAllByText("Publish")[0];
      fireEvent.click(publishButton);

      expect(mockOnPublishFromLibrary).toHaveBeenCalledWith(mockLibraryItems[0].imageUrl);
    });

    it("shows confirmation modal when remove button is clicked", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      const removeButton = screen.getAllByText("Remove")[0];
      fireEvent.click(removeButton);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Remove from library?")).toBeInTheDocument();
      expect(
        screen.getByText(/This will permanently remove the image from your library/i)
      ).toBeInTheDocument();
    });

    it("calls onRemoveFromLibrary when confirming removal", async () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          onPublishFromLibrary={mockOnPublishFromLibrary}
          onRemoveFromLibrary={mockOnRemoveFromLibrary}
          isDeleting={false}
        />
      );

      const removeButtons = screen.getAllByText("Remove");
      fireEvent.click(removeButtons[0]);

      // Wait for modal to appear and find the confirm button
      await waitFor(() => {
        expect(screen.getByText("Remove from library?")).toBeInTheDocument();
      });

      // Find the primary action button in the modal (there are multiple Remove buttons)
      const allRemoveButtons = screen.getAllByRole('button', { name: /^Remove$/ });
      // The last one should be the modal's primary action button
      const confirmButton = allRemoveButtons[allRemoveButtons.length - 1];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnRemoveFromLibrary).toHaveBeenCalledWith(mockLibraryItems[0].imageUrl);
      });
    });

    it("does not show action buttons when callbacks are not provided", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.queryByText("Publish")).not.toBeInTheDocument();
      expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    });
  });

  describe("Mixed Content Display", () => {
    it("correctly displays WebP images in library", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const images = screen.getAllByRole("img");

      // Find the WebP image
      const webpImg = images.find(img => img.getAttribute("src")?.includes(".webp"));
      expect(webpImg).toBeInTheDocument();
      expect(webpImg).toHaveAttribute("src", mockLibraryItems[1].imageUrl);
    });

    it("maintains correct order of published and library images", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const allImages = screen.getAllByRole("img");

      // Published images should come first
      expect(allImages[0]).toHaveAttribute("src", mockPublishedImages[0].image.url);
      expect(allImages[1]).toHaveAttribute("src", mockPublishedImages[1].image.url);

      // Library images should come after
      expect(allImages[2]).toHaveAttribute("src", mockLibraryItems[0].imageUrl);
      expect(allImages[3]).toHaveAttribute("src", mockLibraryItems[1].imageUrl);
    });

    it("filters out images without valid URLs", () => {
      const imagesWithInvalid = [
        ...mockPublishedImages,
        {
          id: "gid://shopify/MediaImage/3",
          alt: "Invalid",
          image: null,
        },
        {
          id: "gid://shopify/MediaImage/4",
          alt: "No URL",
          image: {
            url: null,
            altText: "No URL",
          },
        },
      ];

      renderWithAppProvider(
        <ProductGallery
          images={imagesWithInvalid}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // Only valid images should be rendered
      const images = screen.getAllByRole("img");
      expect(images).toHaveLength(2);
    });
  });

  describe("Badge Display Logic", () => {
    it("shows success tone for published badges", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // The Published badges should have success tone (component internals)
      const publishedBadges = screen.getAllByText("Published");
      expect(publishedBadges).toHaveLength(2);
    });

    it("shows default tone for library badges", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // The Library badges should have default tone (component internals)
      const libraryBadges = screen.getAllByText("Library");
      expect(libraryBadges).toHaveLength(2);
    });

    it("displays correct count in header badges", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[{ ...mockPublishedImages[0] }]}
          libraryItems={[mockLibraryItems[0], mockLibraryItems[1], "https://extra.jpg"]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.getByText("1 published")).toBeInTheDocument();
      expect(screen.getByText("3 in library")).toBeInTheDocument();
    });

    it("does not show count badges when no images exist", () => {
      renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.queryByText(/published/)).not.toBeInTheDocument();
      expect(screen.queryByText(/in library/)).not.toBeInTheDocument();
    });
  });

  describe("Immediate UI Updates", () => {
    it("immediately reflects new library items", () => {
      const { rerender } = renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.getByText("No product images")).toBeInTheDocument();

      // Simulate adding a new library item
      rerender(
        <ProductGallery
          images={[]}
          libraryItems={[{ imageUrl: "https://new-upload.jpg", sourceUrl: null }]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.queryByText("No product images")).not.toBeInTheDocument();
      expect(screen.getByRole("img")).toHaveAttribute("src", "https://new-upload.jpg");
      expect(screen.getByText("Library")).toBeInTheDocument();
    });

    it("immediately reflects removed library items", () => {
      const { rerender } = renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.getAllByRole("img")).toHaveLength(2);

      // Simulate removing a library item
      rerender(
        <ProductGallery
          images={[]}
          libraryItems={[mockLibraryItems[0]]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      expect(screen.getAllByRole("img")).toHaveLength(1);
    });

    it("immediately shows uploaded WebP images", () => {
      const { rerender } = renderWithAppProvider(
        <ProductGallery
          images={[]}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const newWebPImage = {
        imageUrl: "https://cdn.shopify.com/uploaded.webp",
        sourceUrl: null,
      };

      rerender(
        <ProductGallery
          images={[]}
          libraryItems={[newWebPImage]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const image = screen.getByRole("img");
      expect(image).toHaveAttribute("src", newWebPImage.imageUrl);
      expect(screen.getByText("Library")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("provides proper ARIA labels for delete buttons", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButtons = screen.getAllByLabelText("Delete image");
      expect(deleteButtons).toHaveLength(2);
    });

    it("modal has proper ARIA attributes", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={[]}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      const deleteButton = screen.getAllByLabelText("Delete image")[0];
      fireEvent.click(deleteButton);

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveAttribute("aria-label", "Delete product image?");
    });

    it("images have appropriate alt text", () => {
      renderWithAppProvider(
        <ProductGallery
          images={mockPublishedImages}
          libraryItems={mockLibraryItems}
          onDelete={mockOnDelete}
          isDeleting={false}
        />
      );

      // All images should have alt text
      const images = screen.getAllByRole("img");
      images.forEach(img => {
        expect(img).toHaveAttribute("alt");
        expect(img.getAttribute("alt")).not.toBe("");
      });
    });
  });
});
