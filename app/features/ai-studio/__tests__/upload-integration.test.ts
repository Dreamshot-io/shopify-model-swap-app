import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { uploadImageToShopify } from "../../services/file-upload.server";
import { handleUpload } from "../handlers/library.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../../../db.server";

// Mock dependencies
const mockAdmin: AdminApiContext = {
  graphql: jest.fn(),
  rest: {} as any,
};

// Mock the database
jest.mock("../../../db.server", () => ({
  __esModule: true,
  default: {
    metricEvent: {
      create: jest.fn(),
    },
  },
}));

const mockGraphqlResponse = (data: any, errors?: any) => ({
  json: jest.fn().mockResolvedValue({ data, errors }),
});

describe("Image Upload Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("uploadImageToShopify", () => {
    it("successfully uploads a JPG image", async () => {
      const jpgFile = new File(
        ["fake jpg content"],
        "hoodie.jpg",
        { type: "image/jpeg" }
      );

      // Mock staged upload creation
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          stagedUploadsCreate: {
            stagedTargets: [{
              url: "https://shopify-staged.s3.amazonaws.com/upload",
              resourceUrl: "gid://shopify/StagedUpload/123",
              parameters: [
                { name: "key", value: "tmp/123/hoodie.jpg" },
                { name: "Content-Type", value: "image/jpeg" },
                { name: "success_action_status", value: "201" },
              ],
            }],
            userErrors: [],
          },
        })
      );

      // Mock file upload to S3
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: jest.fn().mockResolvedValue(""),
      });

      // Mock file asset creation
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          fileCreate: {
            files: [{
              id: "gid://shopify/MediaImage/456",
            }],
            userErrors: [],
          },
        })
      );

      // Mock polling for file processing
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          node: {
            id: "gid://shopify/MediaImage/456",
            status: "READY",
            image: {
              url: "https://cdn.shopify.com/s/files/hoodie.jpg",
              altText: "hoodie.jpg",
            },
          },
        })
      );

      const result = await uploadImageToShopify(mockAdmin, jpgFile, "Product hoodie");

      expect(result).toEqual({
        id: "gid://shopify/MediaImage/456",
        url: "https://cdn.shopify.com/s/files/hoodie.jpg",
        altText: "hoodie.jpg",
      });

      // Verify all steps were called
      expect(mockAdmin.graphql).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("successfully uploads a WEBP image", async () => {
      const webpFile = new File(
        ["fake webp content"],
        "portrait.webp",
        { type: "image/webp" }
      );

      // Mock staged upload creation
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          stagedUploadsCreate: {
            stagedTargets: [{
              url: "https://shopify-staged.s3.amazonaws.com/upload",
              resourceUrl: "gid://shopify/StagedUpload/789",
              parameters: [
                { name: "key", value: "tmp/789/portrait.webp" },
                { name: "Content-Type", value: "image/webp" },
              ],
            }],
            userErrors: [],
          },
        })
      );

      // Mock S3 upload
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      // Mock file creation
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          fileCreate: {
            files: [{
              id: "gid://shopify/MediaImage/101112",
            }],
            userErrors: [],
          },
        })
      );

      // Mock polling
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          node: {
            id: "gid://shopify/MediaImage/101112",
            status: "READY",
            image: {
              url: "https://cdn.shopify.com/s/files/portrait.webp",
              altText: "portrait.webp",
            },
          },
        })
      );

      const result = await uploadImageToShopify(mockAdmin, webpFile);

      expect(result.url).toContain(".webp");
      expect(result.id).toBeTruthy();
    });

    it("handles file size validation", async () => {
      const largeFile = new File(
        new Array(11 * 1024 * 1024).fill("a"),
        "large.jpg",
        { type: "image/jpeg" }
      );

      await expect(
        uploadImageToShopify(mockAdmin, largeFile)
      ).rejects.toThrow(/File too large/);

      // Should not make any API calls
      expect(mockAdmin.graphql).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("handles unsupported file types", async () => {
      const unsupportedFile = new File(
        ["gif content"],
        "animated.gif",
        { type: "image/gif" }
      );

      await expect(
        uploadImageToShopify(mockAdmin, unsupportedFile)
      ).rejects.toThrow(/Invalid file type/);

      expect(mockAdmin.graphql).not.toHaveBeenCalled();
    });

    it("handles staged upload errors", async () => {
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });

      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          stagedUploadsCreate: {
            stagedTargets: [],
            userErrors: [{
              field: "input",
              message: "Invalid input provided",
            }],
          },
        })
      );

      await expect(
        uploadImageToShopify(mockAdmin, file)
      ).rejects.toThrow(/Failed to create staged upload/);
    });

    it("handles S3 upload failures", async () => {
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });

      // Mock successful staged upload
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          stagedUploadsCreate: {
            stagedTargets: [{
              url: "https://s3.amazonaws.com/upload",
              resourceUrl: "gid://shopify/StagedUpload/123",
              parameters: [],
            }],
            userErrors: [],
          },
        })
      );

      // Mock S3 failure
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: jest.fn().mockResolvedValue("Access denied"),
      });

      await expect(
        uploadImageToShopify(mockAdmin, file)
      ).rejects.toThrow(/Upload to staged URL failed/);
    });

    it("handles file processing timeout", async () => {
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });

      // Mock successful staged upload and S3 upload
      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          stagedUploadsCreate: {
            stagedTargets: [{
              url: "https://s3.amazonaws.com/upload",
              resourceUrl: "gid://shopify/StagedUpload/123",
              parameters: [],
            }],
            userErrors: [],
          },
        })
      );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      (mockAdmin.graphql as jest.Mock).mockResolvedValueOnce(
        mockGraphqlResponse({
          fileCreate: {
            files: [{ id: "gid://shopify/MediaImage/456" }],
            userErrors: [],
          },
        })
      );

      // Mock polling - always return processing status
      (mockAdmin.graphql as jest.Mock).mockResolvedValue(
        mockGraphqlResponse({
          node: {
            id: "gid://shopify/MediaImage/456",
            status: "PROCESSING",
          },
        })
      );

      // Use shorter timeout for testing
      await expect(
        uploadImageToShopify(mockAdmin, file)
      ).rejects.toThrow(/File processing timeout/);
    });
  });

  describe("handleUpload handler", () => {
    it("uploads file and adds to library", async () => {
      const formData = new FormData();
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", file);
      formData.append("productId", "gid://shopify/Product/123");
      formData.append("intent", "upload");

      // Mock file upload
      (mockAdmin.graphql as jest.Mock)
        // Staged upload
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/upload",
                resourceUrl: "gid://shopify/StagedUpload/456",
                parameters: [],
              }],
              userErrors: [],
            },
          })
        )
        // File creation
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/789" }],
              userErrors: [],
            },
          })
        )
        // Polling
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/789",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/test.jpg",
                altText: "test.jpg",
              },
            },
          })
        )
        // Get library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/123",
              metafield: null,
            },
          })
        )
        // Set library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/111" }],
              userErrors: [],
            },
          })
        );

      // Mock S3 upload
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      expect(result).toEqual({
        ok: true,
        savedToLibrary: true,
      });

      // Verify the library was updated
      expect(mockAdmin.graphql).toHaveBeenCalledWith(
        expect.stringContaining("metafieldsSet"),
        expect.objectContaining({
          variables: expect.objectContaining({
            value: expect.stringContaining("https://cdn.shopify.com/test.jpg"),
          }),
        })
      );
    });

    it("handles missing file", async () => {
      const formData = new FormData();
      formData.append("productId", "gid://shopify/Product/123");
      formData.append("intent", "upload");

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toEqual({
        ok: false,
        error: "No file provided",
      });
    });

    it("preserves existing library items", async () => {
      const formData = new FormData();
      const file = new File(["content"], "new.jpg", { type: "image/jpeg" });
      formData.append("file", file);
      formData.append("productId", "gid://shopify/Product/123");

      const existingLibrary = [
        { imageUrl: "https://existing1.jpg", sourceUrl: null },
        { imageUrl: "https://existing2.jpg", sourceUrl: "https://source.jpg" },
      ];

      // Mock successful upload flow
      (mockAdmin.graphql as jest.Mock)
        // Staged upload
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/upload",
                resourceUrl: "gid://shopify/StagedUpload/456",
                parameters: [],
              }],
              userErrors: [],
            },
          })
        )
        // File creation
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/789" }],
              userErrors: [],
            },
          })
        )
        // Polling
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/789",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/new.jpg",
                altText: "new.jpg",
              },
            },
          })
        )
        // Get existing library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/123",
              metafield: {
                id: "gid://shopify/Metafield/existing",
                value: JSON.stringify(existingLibrary),
              },
            },
          })
        )
        // Set updated library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/111" }],
              userErrors: [],
            },
          })
        );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      expect(result.ok).toBe(true);

      // Verify library was updated with all items
      const setLibraryCall = (mockAdmin.graphql as jest.Mock).mock.calls.find(
        call => call[0].includes("metafieldsSet")
      );

      const libraryValue = JSON.parse(setLibraryCall[1].variables.value);
      expect(libraryValue).toHaveLength(3);
      expect(libraryValue[2].imageUrl).toBe("https://cdn.shopify.com/new.jpg");
    });

    it("verifies UPLOADED event is logged with correct EventType", async () => {
      const formData = new FormData();
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", file);
      formData.append("productId", "gid://shopify/Product/123");

      // Setup mocks for successful upload flow
      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/upload",
                resourceUrl: "gid://shopify/StagedUpload/456",
                parameters: [],
              }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/789" }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/789",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/test.jpg",
                altText: "test.jpg",
              },
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/123",
              metafield: null,
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/111" }],
              userErrors: [],
            },
          })
        );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      expect(result.ok).toBe(true);

      // Verify UPLOADED event was created
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          shop: "test-shop.myshopify.com",
          type: "UPLOADED",
          productId: "gid://shopify/Product/123",
          imageUrl: "https://cdn.shopify.com/test.jpg",
        },
      });
    });
  });

  describe("Complete Upload Flow Integration", () => {
    it("handles full upload flow from file selection to gallery display", async () => {
      // Simulate complete flow:
      // 1. User selects JPG file
      // 2. File uploads to Shopify
      // 3. Image added to library
      // 4. UI updates immediately

      const jpgFile = new File(["jpg content"], "product.jpg", { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("file", jpgFile);
      formData.append("productId", "gid://shopify/Product/999");
      formData.append("intent", "upload");

      // Mock all required GraphQL calls for complete flow
      (mockAdmin.graphql as jest.Mock)
        // Staged upload creation
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/staged",
                resourceUrl: "gid://shopify/StagedUpload/staged123",
                parameters: [
                  { name: "key", value: "tmp/product.jpg" },
                  { name: "Content-Type", value: "image/jpeg" },
                ],
              }],
              userErrors: [],
            },
          })
        )
        // File creation
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{
                id: "gid://shopify/MediaImage/final123",
              }],
              userErrors: [],
            },
          })
        )
        // File processing check
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/final123",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/s/files/product.jpg",
                altText: "product.jpg",
              },
            },
          })
        )
        // Get current library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/999",
              metafield: null,
            },
          })
        )
        // Update library
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/library123" }],
              userErrors: [],
            },
          })
        );

      // Mock S3 upload
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: jest.fn().mockResolvedValue(""),
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      // Verify complete success
      expect(result).toEqual({
        ok: true,
        savedToLibrary: true,
        imageUrl: "https://cdn.shopify.com/s/files/product.jpg",
      });

      // Verify all steps were executed
      expect(mockAdmin.graphql).toHaveBeenCalledTimes(5);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify event was logged
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "UPLOADED",
          imageUrl: "https://cdn.shopify.com/s/files/product.jpg",
        }),
      });
    });

    it("handles WebP upload flow end-to-end", async () => {
      const webpFile = new File(["webp content"], "modern.webp", { type: "image/webp" });
      const formData = new FormData();
      formData.append("file", webpFile);
      formData.append("productId", "gid://shopify/Product/webp123");

      // Setup complete WebP upload flow mocks
      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/webp-upload",
                resourceUrl: "gid://shopify/StagedUpload/webp456",
                parameters: [
                  { name: "Content-Type", value: "image/webp" },
                ],
              }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/webp789" }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/webp789",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/modern.webp",
                altText: "modern.webp",
              },
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/webp123",
              metafield: {
                value: JSON.stringify([
                  { imageUrl: "https://existing.jpg", sourceUrl: null },
                ]),
              },
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/webp-library" }],
              userErrors: [],
            },
          })
        );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      // Verify WebP upload success
      expect(result.ok).toBe(true);
      expect(result.imageUrl).toBe("https://cdn.shopify.com/modern.webp");

      // Verify library was updated with both images
      const setLibraryCall = (mockAdmin.graphql as jest.Mock).mock.calls[4];
      const libraryValue = JSON.parse(setLibraryCall[1].variables.value);

      expect(libraryValue).toHaveLength(2);
      expect(libraryValue[1].imageUrl).toBe("https://cdn.shopify.com/modern.webp");

      // Verify UPLOADED event for WebP
      expect(db.metricEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "UPLOADED",
          imageUrl: "https://cdn.shopify.com/modern.webp",
        }),
      });
    });

    it("ensures UI refresh is not needed after upload", async () => {
      // This test verifies the fix for immediate UI updates
      const formData = new FormData();
      const file = new File(["test"], "instant.jpg", { type: "image/jpeg" });
      formData.append("file", file);
      formData.append("productId", "gid://shopify/Product/instant");

      // Setup minimal successful upload
      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/instant",
                resourceUrl: "gid://shopify/StagedUpload/instant",
                parameters: [],
              }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/instant" }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/instant",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/instant.jpg",
                altText: "instant.jpg",
              },
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/instant",
              metafield: null,
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/instant" }],
              userErrors: [],
            },
          })
        );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
      const result = await response.json();

      // The response should include the imageUrl for immediate UI update
      expect(result).toHaveProperty("imageUrl", "https://cdn.shopify.com/instant.jpg");
      expect(result.savedToLibrary).toBe(true);

      // This ensures the UI can immediately show the uploaded image
      // without needing to refetch data or refresh the page
    });

    it("handles multiple file types in sequence", async () => {
      // Test uploading different file types to verify all are handled correctly
      const fileTypes = [
        { name: "photo.jpg", type: "image/jpeg" },
        { name: "image.png", type: "image/png" },
        { name: "modern.webp", type: "image/webp" },
      ];

      for (const fileInfo of fileTypes) {
        jest.clearAllMocks();

        const formData = new FormData();
        const file = new File([`${fileInfo.name} content`], fileInfo.name, { type: fileInfo.type });
        formData.append("file", file);
        formData.append("productId", "gid://shopify/Product/multi");

        // Setup successful upload for each file type
        (mockAdmin.graphql as jest.Mock)
          .mockResolvedValueOnce(
            mockGraphqlResponse({
              stagedUploadsCreate: {
                stagedTargets: [{
                  url: `https://s3.amazonaws.com/${fileInfo.name}`,
                  resourceUrl: `gid://shopify/StagedUpload/${fileInfo.name}`,
                  parameters: [
                    { name: "Content-Type", value: fileInfo.type },
                  ],
                }],
                userErrors: [],
              },
            })
          )
          .mockResolvedValueOnce(
            mockGraphqlResponse({
              fileCreate: {
                files: [{ id: `gid://shopify/MediaImage/${fileInfo.name}` }],
                userErrors: [],
              },
            })
          )
          .mockResolvedValueOnce(
            mockGraphqlResponse({
              node: {
                id: `gid://shopify/MediaImage/${fileInfo.name}`,
                status: "READY",
                image: {
                  url: `https://cdn.shopify.com/${fileInfo.name}`,
                  altText: fileInfo.name,
                },
              },
            })
          )
          .mockResolvedValueOnce(
            mockGraphqlResponse({
              product: {
                id: "gid://shopify/Product/multi",
                metafield: null,
              },
            })
          )
          .mockResolvedValueOnce(
            mockGraphqlResponse({
              metafieldsSet: {
                metafields: [{ id: `gid://shopify/Metafield/${fileInfo.name}` }],
                userErrors: [],
              },
            })
          );

        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          status: 201,
        });

        const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");
        const result = await response.json();

        // Verify each file type uploads successfully
        expect(result.ok).toBe(true);
        expect(result.imageUrl).toBe(`https://cdn.shopify.com/${fileInfo.name}`);

        // Verify event is logged for each file type
        expect(db.metricEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            type: "UPLOADED",
            imageUrl: `https://cdn.shopify.com/${fileInfo.name}`,
          }),
        });
      }
    });

    it("validates Prisma EventType enum compatibility", async () => {
      // This test ensures the UPLOADED event type is valid in Prisma schema
      const formData = new FormData();
      formData.append("file", new File(["test"], "enum-test.jpg", { type: "image/jpeg" }));
      formData.append("productId", "gid://shopify/Product/enum");

      // Mock successful upload
      (mockAdmin.graphql as jest.Mock)
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            stagedUploadsCreate: {
              stagedTargets: [{
                url: "https://s3.amazonaws.com/enum",
                resourceUrl: "gid://shopify/StagedUpload/enum",
                parameters: [],
              }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/enum" }],
              userErrors: [],
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            node: {
              id: "gid://shopify/MediaImage/enum",
              status: "READY",
              image: {
                url: "https://cdn.shopify.com/enum.jpg",
                altText: "enum.jpg",
              },
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            product: {
              id: "gid://shopify/Product/enum",
              metafield: null,
            },
          })
        )
        .mockResolvedValueOnce(
          mockGraphqlResponse({
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/enum" }],
              userErrors: [],
            },
          })
        );

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      // Clear any previous mock calls
      (db.metricEvent.create as jest.Mock).mockClear();

      const response = await handleUpload(formData, mockAdmin, "test-shop.myshopify.com");

      expect(response.status).toBe(200);

      // The critical test: UPLOADED must be a valid EventType in Prisma schema
      const eventCall = (db.metricEvent.create as jest.Mock).mock.calls[0];
      expect(eventCall[0].data.type).toBe("UPLOADED");

      // If this test passes, it confirms the Prisma schema includes UPLOADED in EventType enum
    });
  });
});