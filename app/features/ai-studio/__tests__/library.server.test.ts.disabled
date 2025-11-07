import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { handleUpload, handleSaveToLibrary, handleDeleteFromLibrary } from "../handlers/library.server";
import { EventType } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../../../db.server";

// Mock the database
jest.mock("../../../db.server", () => ({
  __esModule: true,
  default: {
    metricEvent: {
      create: jest.fn(),
    },
  },
}));

// Mock the file upload service
jest.mock("../../../services/file-upload.server", () => ({
  uploadImageToShopify: jest.fn(),
}));

const { uploadImageToShopify } = require("../../../services/file-upload.server");

describe("library.server handlers", () => {
  const mockAdmin: AdminApiContext = {
    graphql: jest.fn(),
    rest: {} as any,
  };

  const mockGraphqlResponse = (data: any, errors?: any) => ({
    json: jest.fn().mockResolvedValue({ data, errors }),
  });

  const testShop = "test-shop.myshopify.com";
  const testProductId = "gid://shopify/Product/123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleUpload", () => {
    it("successfully uploads a file and logs UPLOADED event", async () => {
      const formData = new FormData();
      const testFile = new File(["test content"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", testFile);
      formData.append("productId", testProductId);

      // Mock successful upload
      uploadImageToShopify.mockResolvedValueOnce({
        id: "gid://shopify/MediaImage/456",
        url: "https://cdn.shopify.com/uploaded-test.jpg",
        altText: "test.jpg",
      });

      // Mock getting current library (empty)
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: null,
          },
        })
      );

      // Mock setting library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/789" }],
            userErrors: [],
          },
        })
      );

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      // Verify successful response
      expect(result).toEqual({
        ok: true,
        savedToLibrary: true,
        imageUrl: "https://cdn.shopify.com/uploaded-test.jpg",
      });

      // Verify UPLOADED event was logged with correct type
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          shop: testShop,
          type: EventType.UPLOADED,
          productId: testProductId,
          imageUrl: "https://cdn.shopify.com/uploaded-test.jpg",
        },
      });
    });

    it("successfully uploads WebP file and adds to library", async () => {
      const formData = new FormData();
      const webpFile = new File(["webp content"], "image.webp", { type: "image/webp" });
      formData.append("file", webpFile);
      formData.append("productId", testProductId);

      // Mock successful WebP upload
      uploadImageToShopify.mockResolvedValueOnce({
        id: "gid://shopify/MediaImage/webp123",
        url: "https://cdn.shopify.com/image.webp",
        altText: "image.webp",
      });

      // Mock getting current library with existing items
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: {
              id: "gid://shopify/Metafield/existing",
              value: JSON.stringify([
                { imageUrl: "https://existing.jpg", sourceUrl: null },
              ]),
            },
          },
        })
      );

      // Mock setting updated library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/updated" }],
            userErrors: [],
          },
        })
      );

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      // Verify response
      expect(result.ok).toBe(true);
      expect(result.imageUrl).toBe("https://cdn.shopify.com/image.webp");

      // Verify WebP file was uploaded
      expect(uploadImageToShopify).toHaveBeenCalledWith(
        mockAdmin,
        webpFile,
        expect.stringContaining("AI Studio upload")
      );

      // Verify UPLOADED event for WebP
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          shop: testShop,
          type: EventType.UPLOADED,
          productId: testProductId,
          imageUrl: "https://cdn.shopify.com/image.webp",
        },
      });
    });

    it("returns error when no file is provided", async () => {
      const formData = new FormData();
      formData.append("productId", testProductId);

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toEqual({
        ok: false,
        error: "No file provided",
      });

      // Verify no event was logged
      expect(db.metricEvent.create).not.toHaveBeenCalled();
    });

    it("handles upload service failures gracefully", async () => {
      const formData = new FormData();
      const testFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", testFile);
      formData.append("productId", testProductId);

      // Mock upload failure
      uploadImageToShopify.mockRejectedValueOnce(new Error("Upload service error"));

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result).toEqual({
        ok: false,
        error: "Upload service error",
      });

      // Verify no event was logged on failure
      expect(db.metricEvent.create).not.toHaveBeenCalled();
    });

    it("handles metafield update errors", async () => {
      const formData = new FormData();
      const testFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", testFile);
      formData.append("productId", testProductId);

      // Mock successful upload
      uploadImageToShopify.mockResolvedValueOnce({
        id: "gid://shopify/MediaImage/456",
        url: "https://cdn.shopify.com/test.jpg",
        altText: "test.jpg",
      });

      // Mock getting library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: { id: testProductId, metafield: null },
        })
      );

      // Mock metafield update failure
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: {
            metafields: [],
            userErrors: [
              { field: "value", message: "Invalid JSON format" },
            ],
          },
        })
      );

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toEqual({
        ok: false,
        error: "Invalid JSON format",
      });

      // Verify no event was logged on metafield error
      expect(db.metricEvent.create).not.toHaveBeenCalled();
    });

    it("continues successfully even if event logging fails", async () => {
      const formData = new FormData();
      const testFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", testFile);
      formData.append("productId", testProductId);

      // Mock successful upload
      uploadImageToShopify.mockResolvedValueOnce({
        id: "gid://shopify/MediaImage/456",
        url: "https://cdn.shopify.com/test.jpg",
        altText: "test.jpg",
      });

      // Mock GraphQL operations
      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: { id: testProductId, metafield: null },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/789" }],
              userErrors: [],
            },
          })
        );

      // Mock event logging failure
      (db.metricEvent.create as jest.Mock).mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      // Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      const response = await handleUpload(formData, mockAdmin, testShop);
      const result = await response.json();

      // Should still return success
      expect(result).toEqual({
        ok: true,
        savedToLibrary: true,
        imageUrl: "https://cdn.shopify.com/test.jpg",
      });

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to log upload event:",
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it("preserves existing library items when adding new upload", async () => {
      const formData = new FormData();
      const testFile = new File(["new"], "new.jpg", { type: "image/jpeg" });
      formData.append("file", testFile);
      formData.append("productId", testProductId);

      const existingItems = [
        { imageUrl: "https://existing1.jpg", sourceUrl: null },
        { imageUrl: "https://existing2.webp", sourceUrl: "https://source.jpg" },
      ];

      // Mock successful upload
      uploadImageToShopify.mockResolvedValueOnce({
        id: "gid://shopify/MediaImage/new",
        url: "https://cdn.shopify.com/new.jpg",
        altText: "new.jpg",
      });

      // Mock getting existing library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: {
              id: "gid://shopify/Metafield/existing",
              value: JSON.stringify(existingItems),
            },
          },
        })
      );

      // Mock setting updated library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/updated" }],
            userErrors: [],
          },
        })
      );

      await handleUpload(formData, mockAdmin, testShop);

      // Verify the library update includes all items
      const setLibraryCall = (mockAdmin.graphql as jest.Mock).mock.calls[1];
      const libraryValue = JSON.parse(setLibraryCall[1].variables.value);

      expect(libraryValue).toHaveLength(3);
      expect(libraryValue[0]).toEqual(existingItems[0]);
      expect(libraryValue[1]).toEqual(existingItems[1]);
      expect(libraryValue[2]).toEqual({
        imageUrl: "https://cdn.shopify.com/new.jpg",
        sourceUrl: null,
      });
    });
  });

  describe("handleSaveToLibrary", () => {
    it("saves new image to library and logs LIBRARY_SAVED event", async () => {
      const formData = new FormData();
      formData.append("imageUrl", "https://generated.jpg");
      formData.append("sourceUrl", "https://source.jpg");
      formData.append("productId", testProductId);

      // Mock getting empty library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: { id: testProductId, metafield: null },
        })
      );

      // Mock setting library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: { userErrors: [] },
        })
      );

      const response = await handleSaveToLibrary(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(result).toEqual({
        ok: true,
        savedToLibrary: true,
      });

      // Verify LIBRARY_SAVED event was logged
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          shop: testShop,
          type: EventType.LIBRARY_SAVED,
          productId: testProductId,
          imageUrl: "https://generated.jpg",
        },
      });
    });

    it("detects and handles duplicate library items", async () => {
      const formData = new FormData();
      formData.append("imageUrl", "https://existing.jpg");
      formData.append("productId", testProductId);

      // Mock getting library with existing item
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: {
              value: JSON.stringify([
                { imageUrl: "https://existing.jpg", sourceUrl: null },
              ]),
            },
          },
        })
      );

      const response = await handleSaveToLibrary(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(result).toEqual({
        ok: true,
        savedToLibrary: false,
        duplicate: true,
      });

      // Verify no event was logged for duplicate
      expect(db.metricEvent.create).not.toHaveBeenCalled();
    });
  });

  describe("handleDeleteFromLibrary", () => {
    it("removes image from library and logs LIBRARY_DELETED event", async () => {
      const formData = new FormData();
      formData.append("imageUrl", "https://to-delete.jpg");
      formData.append("productId", testProductId);

      // Mock getting library with multiple items
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: {
              value: JSON.stringify([
                { imageUrl: "https://keep1.jpg", sourceUrl: null },
                { imageUrl: "https://to-delete.jpg", sourceUrl: null },
                { imageUrl: "https://keep2.webp", sourceUrl: null },
              ]),
            },
          },
        })
      );

      // Mock setting updated library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: { userErrors: [] },
        })
      );

      const response = await handleDeleteFromLibrary(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(result).toEqual({
        ok: true,
        deletedFromLibrary: true,
      });

      // Verify the library update removed the correct item
      const setLibraryCall = (mockAdmin.graphql as jest.Mock).mock.calls[1];
      const libraryValue = JSON.parse(setLibraryCall[1].variables.value);

      expect(libraryValue).toHaveLength(2);
      expect(libraryValue).not.toContainEqual({
        imageUrl: "https://to-delete.jpg",
        sourceUrl: null,
      });

      // Verify LIBRARY_DELETED event was logged
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          shop: testShop,
          type: EventType.LIBRARY_DELETED,
          productId: testProductId,
          imageUrl: "https://to-delete.jpg",
        },
      });
    });

    it("handles deletion of string-format library items", async () => {
      const formData = new FormData();
      formData.append("imageUrl", "https://string-item.jpg");
      formData.append("productId", testProductId);

      // Mock getting library with mixed format items
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: {
              value: JSON.stringify([
                "https://string-item.jpg",
                { imageUrl: "https://object-item.jpg", sourceUrl: null },
              ]),
            },
          },
        })
      );

      // Mock setting updated library
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          metafieldsSet: { userErrors: [] },
        })
      );

      const response = await handleDeleteFromLibrary(formData, mockAdmin, testShop);
      const result = await response.json();

      expect(result.ok).toBe(true);

      // Verify the string item was removed
      const setLibraryCall = (mockAdmin.graphql as jest.Mock).mock.calls[1];
      const libraryValue = JSON.parse(setLibraryCall[1].variables.value);

      expect(libraryValue).toHaveLength(1);
      expect(libraryValue[0]).toEqual({
        imageUrl: "https://object-item.jpg",
        sourceUrl: null,
      });
    });
  });

  describe("Event Type Validation", () => {
    it("uses correct EventType enum values", async () => {
      // Test UPLOADED event type
      const uploadFormData = new FormData();
      uploadFormData.append("file", new File(["test"], "test.jpg", { type: "image/jpeg" }));
      uploadFormData.append("productId", testProductId);

      uploadImageToShopify.mockResolvedValueOnce({
        url: "https://test.jpg",
        id: "123",
        altText: "test",
      });

      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(mockGraphqlResponse({ product: { id: testProductId, metafield: null } }))
        .mockResolvedValueOnce(mockGraphqlResponse({ metafieldsSet: { metafields: [{ id: "1" }], userErrors: [] } }));

      await handleUpload(uploadFormData, mockAdmin, testShop);

      // Verify UPLOADED is a valid EventType
      const uploadCall = (db.metricEvent.create as jest.Mock).mock.calls[0];
      expect(uploadCall[0].data.type).toBe(EventType.UPLOADED);

      // Test LIBRARY_SAVED event type
      jest.clearAllMocks();
      const saveFormData = new FormData();
      saveFormData.append("imageUrl", "https://save.jpg");
      saveFormData.append("productId", testProductId);

      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(mockGraphqlResponse({ product: { id: testProductId, metafield: null } }))
        .mockResolvedValueOnce(mockGraphqlResponse({ metafieldsSet: { userErrors: [] } }));

      await handleSaveToLibrary(saveFormData, mockAdmin, testShop);

      // Verify LIBRARY_SAVED is a valid EventType
      const saveCall = (db.metricEvent.create as jest.Mock).mock.calls[0];
      expect(saveCall[0].data.type).toBe(EventType.LIBRARY_SAVED);

      // Test LIBRARY_DELETED event type
      jest.clearAllMocks();
      const deleteFormData = new FormData();
      deleteFormData.append("imageUrl", "https://delete.jpg");
      deleteFormData.append("productId", testProductId);

      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(mockGraphqlResponse({
          product: {
            id: testProductId,
            metafield: { value: JSON.stringify([{ imageUrl: "https://delete.jpg", sourceUrl: null }]) },
          },
        }))
        .mockResolvedValueOnce(mockGraphqlResponse({ metafieldsSet: { userErrors: [] } }));

      await handleDeleteFromLibrary(deleteFormData, mockAdmin, testShop);

      // Verify LIBRARY_DELETED is a valid EventType
      const deleteCall = (db.metricEvent.create as jest.Mock).mock.calls[0];
      expect(deleteCall[0].data.type).toBe(EventType.LIBRARY_DELETED);
    });
  });
});
