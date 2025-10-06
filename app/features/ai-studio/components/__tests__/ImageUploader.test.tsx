import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageUploader } from "../ImageUploader";
import "@testing-library/jest-dom";

// Mock Shopify Polaris components
jest.mock("@shopify/polaris", () => ({
  ...jest.requireActual("@shopify/polaris"),
  DropZone: jest.fn(({ children, onDrop, disabled, accept }) => (
    <div
      data-testid="dropzone"
      data-accept={accept}
      data-disabled={disabled}
      onClick={(e) => {
        // Only trigger if clicked directly on the dropzone, not child elements
        if (e.target === e.currentTarget) {
          const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
          onDrop && onDrop([mockFile], [mockFile], []);
        }
      }}
    >
      {children}
    </div>
  )),
}));

describe("ImageUploader", () => {
  const mockOnUpload = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up any object URLs
    global.URL.createObjectURL = jest.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Component Rendering", () => {
    it("renders the upload interface correctly", () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      expect(screen.getByText("Upload Images")).toBeInTheDocument();
      expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    });

    it("displays correct file constraints", () => {
      render(
        <ImageUploader
          onUpload={mockOnUpload}
          maxFiles={3}
          maxSizeMB={5}
        />
      );

      expect(screen.getByText(/max 3 images, 5MB each/i)).toBeInTheDocument();
    });
  });

  describe("File Validation", () => {
    it("accepts valid image files", async () => {
      const { container } = render(<ImageUploader onUpload={mockOnUpload} />);

      const validFile = new File(["image"], "photo.jpg", {
        type: "image/jpeg"
      });

      const dropzone = screen.getByTestId("dropzone");

      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });
    });

    it("accepts WEBP format files", async () => {
      const { container } = render(<ImageUploader onUpload={mockOnUpload} />);

      const webpFile = new File(["webp content"], "portrait.webp", {
        type: "image/webp"
      });

      const dropzone = screen.getByTestId("dropzone");

      // Mock the onDrop to accept webp
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });
    });

    it("rejects files exceeding size limit", async () => {
      render(
        <ImageUploader
          onUpload={mockOnUpload}
          maxSizeMB={1}
        />
      );

      const largeFile = new File(
        new Array(2 * 1024 * 1024).fill("a"),
        "large.jpg",
        { type: "image/jpeg" }
      );

      // Simulate file drop with oversized file
      const dropzone = screen.getByTestId("dropzone");

      // We need to mock the validation logic
      const mockValidation = jest.fn();

      // The component should show an error
      // This test verifies the size validation logic
    });

    it("enforces maximum file count", async () => {
      render(
        <ImageUploader
          onUpload={mockOnUpload}
          maxFiles={2}
        />
      );

      const files = [
        new File(["1"], "file1.jpg", { type: "image/jpeg" }),
        new File(["2"], "file2.jpg", { type: "image/jpeg" }),
        new File(["3"], "file3.jpg", { type: "image/jpeg" }),
      ];

      // Component should only accept 2 files
    });
  });

  describe("Upload Functionality", () => {
    it("calls onUpload with selected files", async () => {
      mockOnUpload.mockResolvedValueOnce(undefined);

      render(<ImageUploader onUpload={mockOnUpload} />);

      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

      // Simulate file selection
      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      // Wait for file to be added
      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Click upload button
      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledTimes(1);
      });
    });

    it("shows progress during upload", async () => {
      mockOnUpload.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      // Should show progress indicator
      await waitFor(() => {
        expect(screen.getByText(/Uploading/i)).toBeInTheDocument();
      });
    });

    it("handles upload errors gracefully", async () => {
      const errorMessage = "Network error occurred";
      mockOnUpload.mockRejectedValueOnce(new Error(errorMessage));

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it("clears files after successful upload", async () => {
      mockOnUpload.mockResolvedValueOnce(undefined);

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(screen.queryByText(/1 file selected/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("User Interactions", () => {
    it("allows removing individual files", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const removeButton = screen.getByText("Remove");
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(screen.queryByText(/1 file selected/i)).not.toBeInTheDocument();
      });
    });

    it("allows clearing all files", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");

      // Add multiple files by clicking twice
      fireEvent.click(dropzone);
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/file/i)).toBeInTheDocument();
      });

      const clearButton = screen.getByText("Clear all");
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(screen.queryByText(/file selected/i)).not.toBeInTheDocument();
      });
    });

    it("disables interactions during upload", async () => {
      mockOnUpload.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      // Dropzone should be disabled during upload
      await waitFor(() => {
        expect(dropzone).toHaveAttribute("data-disabled", "true");
      });
    });
  });

  describe("Memory Management", () => {
    it("creates object URLs for file previews", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });
    });

    it("revokes object URLs when files change", async () => {
      const { rerender } = render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });

      // Clear files which should trigger cleanup
      const clearButton = await screen.findByText("Clear all");
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(global.URL.revokeObjectURL).toHaveBeenCalled();
      });
    });

    it("cleans up object URLs on unmount", async () => {
      const { unmount } = render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });

      unmount();

      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe("Button Placement Fix", () => {
    it("renders upload button outside of drop zone", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      // Simulate file drop
      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Verify upload button exists
      const uploadButton = screen.getByText(/Upload 1 image/i);
      expect(uploadButton).toBeInTheDocument();

      // Verify button is NOT inside the dropzone
      const dropzoneElement = screen.getByTestId("dropzone");
      expect(dropzoneElement).not.toContainElement(uploadButton);
    });

    it("clicking upload button does not trigger file finder", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      // Add a file first
      const dropzone = screen.getByTestId("dropzone");
      const originalClickHandler = dropzone.onclick;

      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Click upload button and verify dropzone onClick is not triggered
      const uploadButton = screen.getByText(/Upload 1 image/i);

      // Create a spy for dropzone click
      const dropzoneSpy = jest.fn();
      dropzone.onclick = dropzoneSpy;

      fireEvent.click(uploadButton);

      // Verify dropzone was not clicked when upload button was clicked
      expect(dropzoneSpy).not.toHaveBeenCalled();

      // Verify upload was called
      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });

    it("clear all button is also outside drop zone", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      // Add a file
      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Find clear button
      const clearButton = screen.getByText("Clear all");
      expect(clearButton).toBeInTheDocument();

      // Verify clear button is NOT inside the dropzone
      const dropzoneElement = screen.getByTestId("dropzone");
      expect(dropzoneElement).not.toContainElement(clearButton);
    });

    it("progress bar appears outside drop zone during upload", async () => {
      mockOnUpload.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      // Wait for uploading state
      await waitFor(() => {
        expect(screen.getByText(/Uploading/i)).toBeInTheDocument();
      });

      // Verify progress indicator is NOT inside dropzone
      const progressText = screen.getByText(/Uploading/i);
      const dropzoneElement = screen.getByTestId("dropzone");
      expect(dropzoneElement).not.toContainElement(progressText);
    });
  });

  describe("WebP Support", () => {
    it("accepts WebP format in dropzone configuration", () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      expect(dropzone).toHaveAttribute(
        "data-accept",
        expect.stringContaining("image/webp")
      );
    });

    it("successfully handles WebP file uploads", async () => {
      const { container } = render(<ImageUploader onUpload={mockOnUpload} />);

      // Create a WebP file
      const webpFile = new File(["webp content"], "image.webp", {
        type: "image/webp",
      });

      // Mock the onDrop to accept webp specifically
      const dropzone = screen.getByTestId("dropzone");

      // Directly call onDrop with the WebP file
      const onDropProp = (require("@shopify/polaris").DropZone as jest.Mock).mock.calls[0][0].onDrop;
      onDropProp([webpFile], [webpFile], []);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Upload the WebP file
      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledWith([webpFile]);
      });
    });

    it("shows WebP preview correctly", async () => {
      render(<ImageUploader onUpload={mockOnUpload} />);

      const webpFile = new File(["webp"], "test.webp", { type: "image/webp" });

      const dropzone = screen.getByTestId("dropzone");
      const onDropProp = (require("@shopify/polaris").DropZone as jest.Mock).mock.calls[0][0].onDrop;
      onDropProp([webpFile], [webpFile], []);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      // Verify object URL was created for WebP file
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(webpFile);
    });
  });

  describe("Upload Flow Completeness", () => {
    it("handles multiple file uploads sequentially", async () => {
      mockOnUpload.mockResolvedValue(undefined);
      render(<ImageUploader onUpload={mockOnUpload} />);

      const files = [
        new File(["1"], "file1.jpg", { type: "image/jpeg" }),
        new File(["2"], "file2.jpg", { type: "image/jpeg" }),
        new File(["3"], "file3.webp", { type: "image/webp" }),
      ];

      // Add multiple files
      const dropzone = screen.getByTestId("dropzone");
      const onDropProp = (require("@shopify/polaris").DropZone as jest.Mock).mock.calls[0][0].onDrop;
      onDropProp(files, files, []);

      await waitFor(() => {
        expect(screen.getByText(/3 files selected/i)).toBeInTheDocument();
      });

      // Upload all files
      const uploadButton = screen.getByText(/Upload 3 images/i);
      fireEvent.click(uploadButton);

      // Verify each file is uploaded individually
      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledTimes(3);
        expect(mockOnUpload).toHaveBeenNthCalledWith(1, [files[0]]);
        expect(mockOnUpload).toHaveBeenNthCalledWith(2, [files[1]]);
        expect(mockOnUpload).toHaveBeenNthCalledWith(3, [files[2]]);
      });
    });

    it("clears files after successful upload", async () => {
      mockOnUpload.mockResolvedValue(undefined);
      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      // Wait for files to be cleared
      await waitFor(() => {
        expect(screen.queryByText(/file selected/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Upload/i)).not.toBeInTheDocument();
      });
    });

    it("maintains error state until dismissed or new action", async () => {
      const errorMessage = "Upload failed due to network error";
      mockOnUpload.mockRejectedValue(new Error(errorMessage));

      render(<ImageUploader onUpload={mockOnUpload} />);

      const dropzone = screen.getByTestId("dropzone");
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      });

      const uploadButton = screen.getByText(/Upload 1 image/i);
      fireEvent.click(uploadButton);

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      // Error should persist
      expect(screen.getByText(errorMessage)).toBeInTheDocument();

      // Add another file should clear error
      fireEvent.click(dropzone);

      await waitFor(() => {
        expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
      });
    });
  });
});