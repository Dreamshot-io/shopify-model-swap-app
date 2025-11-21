import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { json } from "@remix-run/node";
import db, { lookupShopId } from "../../../db.server";
import {
  uploadImageToShopify,
  createStagedUpload,
  finalizeShopifyUpload,
} from "../../../services/file-upload.server";
import { AIStudioMediaService } from "../../../services/ai-studio-media.server";
import type {
  LibraryActionResponse,
  ActionErrorResponse,
  LibraryItem,
} from "../types";

/**
 * Helper: Filter library items by variant ID
 * Returns items that:
 * - Have no variantIds (legacy/all-variants items)
 * - Include the specified variantId in their variantIds array
 */
export function filterLibraryByVariant(
  items: LibraryItem[],
  variantId: string | null,
): LibraryItem[] {
  if (!variantId) return items; // null = show all

  return items.filter((item) => {
    if (typeof item === "string") return true; // Legacy format = all variants
    if (!item.variantIds || item.variantIds.length === 0) return true; // No variants specified = all variants
    return item.variantIds.includes(variantId); // Has this variant
  });
}


export async function handleSaveToLibrary(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const shopId = await lookupShopId(shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${shop}`);
  }

  const imageUrl = String(formData.get("imageUrl") || "");
  const sourceUrl = String(formData.get("sourceUrl") || "");
  const productId = String(formData.get("productId") || "");
  const variantIdsJson = String(formData.get("variantIds") || "");
  const prompt = String(formData.get("prompt") || "");
  const sourceParam = String(formData.get("source") || "");

  // Parse variant IDs if provided
  let variantIds: string[] | undefined;
  if (variantIdsJson) {
    try {
      const parsed = JSON.parse(variantIdsJson);
      variantIds = Array.isArray(parsed) ? parsed : undefined;
    } catch {
      variantIds = undefined;
    }
  }

  const aiStudioMediaService = new AIStudioMediaService(admin, db);

  // Check if already exists
  const exists = await aiStudioMediaService.imageExists(shop, productId, imageUrl, shopId);
  if (exists) {
    const duplicateResponse: LibraryActionResponse = {
      ok: true,
      savedToLibrary: false,
      duplicate: true,
    };
    return json(duplicateResponse, {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Use explicit source parameter, fallback to inference only if not provided
    let source: "AI_GENERATED" | "MANUAL_UPLOAD" | "GALLERY_IMPORT" = "MANUAL_UPLOAD";
    if (sourceParam && (sourceParam === "AI_GENERATED" || sourceParam === "MANUAL_UPLOAD" || sourceParam === "GALLERY_IMPORT")) {
      source = sourceParam;
    } else if (sourceUrl) {
      // Legacy fallback: infer from sourceUrl presence
      source = "AI_GENERATED";
    }

    // If not a Shopify URL, upload to Shopify first
    let finalUrl = imageUrl;
    let mediaId: string | undefined;
    
    const isShopifyUrl = imageUrl.includes('cdn.shopify.com') || imageUrl.includes('shopifycdn.com');
    if (!isShopifyUrl) {
      console.log("[saveToLibrary] Uploading external URL to Shopify:", imageUrl.substring(0, 50) + "...");
      
      // Fetch the image and upload to Shopify
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${imageUrl}: ${response.status}`);
      }
      
      const blob = await response.blob();
      const filename = `ai-generated-${Date.now()}.${blob.type.split('/')[1] || 'png'}`;
      const file = new File([blob], filename, { type: blob.type });
      
      const uploadedFile = await uploadImageToShopify(
        admin,
        file,
        prompt || `AI Studio - ${new Date().toISOString()}`,
      );
      
      finalUrl = uploadedFile.url;
      mediaId = uploadedFile.id;
      console.log("[saveToLibrary] Uploaded to Shopify:", finalUrl, "mediaId:", mediaId);
    }

    // Save to library using the new service
    await aiStudioMediaService.saveToLibrary({
      shop,
      shopId,
      productId,
      url: finalUrl,
      mediaId,
      source,
      prompt: prompt || undefined,
      sourceImageUrl: sourceUrl || undefined,
      variantIds: variantIds || [],
    });

    // Log metric event
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          shopId,
          eventType: 'SAVED_TO_LIBRARY',
          productId,
          imageUrl,
        },
      });
    } catch {}

    const successResponse: LibraryActionResponse = {
      ok: true,
      savedToLibrary: true,
    };
    return json(successResponse, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Failed to save to library:", error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save to library",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function handleDeleteFromLibrary(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const shopId = await lookupShopId(shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${shop}`);
  }

  const imageUrl = String(formData.get("imageUrl") || "");
  const productId = String(formData.get("productId") || "");

  if (!imageUrl || !productId) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing imageUrl or productId",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const aiStudioMediaService = new AIStudioMediaService(admin, db);

    // Find the image in database by URL
    const images = await aiStudioMediaService.getAllImages(shop, productId, undefined, shopId);
    const imageToDelete = images.find(img => img.url === imageUrl);

    if (!imageToDelete) {
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: "Image not found in library",
      };
      return json(errorResponse, {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Delete from database (and gallery if published)
    await aiStudioMediaService.deleteImage(imageToDelete.id, shopId);

    // Log metric event
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          shopId,
          eventType: 'DRAFT_DELETED',
          productId,
          imageUrl,
        },
      });
    } catch {}

    const successResponse: LibraryActionResponse = {
      ok: true,
      deletedFromLibrary: true,
    };
    return json(successResponse, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Failed to delete from library:", error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete from library",
    };
    return json(errorResponse, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function handleUpload(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const shopId = await lookupShopId(shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${shop}`);
  }

  const startTime = Date.now();
  console.log("[UPLOAD:SERVER] Handler called - shop:", shop);

  const file = formData.get("file") as File;
  const productId = String(formData.get("productId") || "");
  const variantIdsJson = String(formData.get("variantIds") || "");

  console.log("[UPLOAD:SERVER] File info:", {
    hasFile: !!file,
    size: file?.size,
    sizeMB: file?.size ? (file.size / 1024 / 1024).toFixed(2) : "N/A",
    name: file?.name,
    type: file?.type,
    productId,
  });

  if (!file || !file.size) {
    console.log("[UPLOAD:SERVER] ✗ Validation failed - no file provided");
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "No file provided",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse variant IDs if provided
  let variantIds: string[] = [];
  if (variantIdsJson) {
    try {
      const parsed = JSON.parse(variantIdsJson);
      variantIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      variantIds = [];
    }
  }

  try {
    console.log("[UPLOAD:SERVER] Step 1/3: Uploading to Shopify...");
    const uploadedFile = await uploadImageToShopify(
      admin,
      file,
      `AI Studio upload - ${new Date().toISOString()}`,
    );
    console.log("[UPLOAD:SERVER] Step 1/3: ✓ Uploaded to Shopify:", uploadedFile.url);

    console.log("[UPLOAD:SERVER] Step 2/3: Saving to library database...");
    const aiStudioMediaService = new AIStudioMediaService(admin, db);

    // Check if already exists
    const exists = await aiStudioMediaService.imageExists(shop, productId, uploadedFile.url, shopId);
    if (!exists) {
      await aiStudioMediaService.saveToLibrary({
        shop,
        shopId,
        productId,
        url: uploadedFile.url,
        mediaId: uploadedFile.id, // Store Shopify mediaId for later use in A/B tests
        source: "MANUAL_UPLOAD",
        variantIds,
      });
      console.log("[UPLOAD:SERVER] Step 2/3: ✓ Saved to library database with mediaId:", uploadedFile.id);
    } else {
      console.log("[UPLOAD:SERVER] Step 2/3: ✓ Image already exists in library");
    }

    console.log("[UPLOAD:SERVER] Step 3/3: Logging metric event...");
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          shopId,
          eventType: 'UPLOADED',
          productId,
          imageUrl: uploadedFile.url,
        },
      });
      console.log("[UPLOAD:SERVER] Step 3/3: ✓ Metric event logged");
    } catch (loggingError) {
      console.warn("[UPLOAD:SERVER] Step 3/3: ⚠ Failed to log upload event:", loggingError);
    }

    const duration = Date.now() - startTime;
    console.log(`[UPLOAD:SERVER] ✓ Upload complete in ${duration}ms:`, uploadedFile.url);

    const successResponse: LibraryActionResponse & { imageUrl: string } = {
      ok: true,
      savedToLibrary: true,
      imageUrl: uploadedFile.url,
    };
    return json(successResponse, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[UPLOAD:SERVER] ✗ Upload failed after ${duration}ms:`, error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error.message || "Upload failed",
    };
    return json(errorResponse, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle getStagedUpload - Returns Shopify staged upload URL for client-side direct upload
 * Bypasses Vercel 4.5MB limit by not sending file through serverless function
 */
export async function handleGetStagedUpload(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  console.log("[GET_STAGED_UPLOAD] Handler called - shop:", shop);

  const filename = String(formData.get("filename") || "");
  const mimeType = String(formData.get("mimeType") || "");
  const fileSize = parseInt(String(formData.get("fileSize") || "0"));
  const productId = String(formData.get("productId") || "");

  console.log("[GET_STAGED_UPLOAD] Request info:", {
    filename,
    mimeType,
    fileSize,
    sizeMB: (fileSize / 1024 / 1024).toFixed(2),
    productId,
  });

  // Validation
  if (!filename || !mimeType || !fileSize) {
    console.log("[GET_STAGED_UPLOAD] ✗ Validation failed - missing parameters");
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing required parameters: filename, mimeType, or fileSize",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[GET_STAGED_UPLOAD] Creating staged upload...");
    const stagedTarget = await createStagedUpload(admin, {
      filename,
      mimeType,
      fileSize,
    });

    console.log("[GET_STAGED_UPLOAD] ✓ Staged upload created:", {
      url: stagedTarget.url,
      resourceUrl: stagedTarget.resourceUrl,
      paramCount: stagedTarget.parameters.length,
    });

    return json(
      {
        ok: true,
        stagedTarget,
      },
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("[GET_STAGED_UPLOAD] ✗ Failed:", error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error.message || "Failed to create staged upload",
    };
    return json(errorResponse, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle completeUpload - Finalizes upload after client has uploaded directly to S3
 * Creates file asset, polls for processing, and updates product metafield
 */
export async function handleCompleteUpload(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const shopId = await lookupShopId(shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${shop}`);
  }

  const startTime = Date.now();
  console.log("[COMPLETE_UPLOAD] Handler called - shop:", shop);

  const resourceUrl = String(formData.get("resourceUrl") || "");
  const filename = String(formData.get("filename") || "");
  const productId = String(formData.get("productId") || "");
  const variantIdsJson = String(formData.get("variantIds") || "");

  console.log("[COMPLETE_UPLOAD] Request info:", {
    resourceUrl,
    filename,
    productId,
  });

  if (!resourceUrl || !filename || !productId) {
    console.log("[COMPLETE_UPLOAD] ✗ Validation failed - missing parameters");
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing required parameters: resourceUrl, filename, or productId",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse variant IDs if provided
  let variantIds: string[] = [];
  if (variantIdsJson) {
    try {
      const parsed = JSON.parse(variantIdsJson);
      variantIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      variantIds = [];
    }
  }

  try {
    console.log("[COMPLETE_UPLOAD] Step 1/3: Finalizing Shopify upload...");
    const uploadedFile = await finalizeShopifyUpload(
      admin,
      resourceUrl,
      filename,
      `AI Studio upload - ${new Date().toISOString()}`,
    );
    console.log("[COMPLETE_UPLOAD] Step 1/3: ✓ Finalized:", uploadedFile.url);

    console.log("[COMPLETE_UPLOAD] Step 2/3: Saving to library database...");
    const aiStudioMediaService = new AIStudioMediaService(admin, db);

    // Check if already exists
    const exists = await aiStudioMediaService.imageExists(shop, productId, uploadedFile.url, shopId);
    if (!exists) {
      await aiStudioMediaService.saveToLibrary({
        shop,
        shopId,
        productId,
        url: uploadedFile.url,
        mediaId: uploadedFile.id, // Store Shopify mediaId for later use in A/B tests
        source: "MANUAL_UPLOAD",
        variantIds,
      });
      console.log("[COMPLETE_UPLOAD] Step 2/3: ✓ Saved to library database with mediaId:", uploadedFile.id);
    } else {
      console.log("[COMPLETE_UPLOAD] Step 2/3: ✓ Image already exists in library");
    }

    // Log metric event
    console.log("[COMPLETE_UPLOAD] Step 3/3: Logging metric event...");
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          shopId,
          eventType: 'UPLOADED',
          productId,
          imageUrl: uploadedFile.url,
        },
      });
      console.log("[COMPLETE_UPLOAD] ✓ Metric event logged");
    } catch (loggingError) {
      console.warn("[COMPLETE_UPLOAD] ⚠ Failed to log upload event:", loggingError);
    }

    const duration = Date.now() - startTime;
    console.log(`[COMPLETE_UPLOAD] ✓ Upload complete in ${duration}ms:`, uploadedFile.url);

    const successResponse: LibraryActionResponse & { imageUrl: string } = {
      ok: true,
      savedToLibrary: true,
      imageUrl: uploadedFile.url,
    };
    return json(successResponse, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[COMPLETE_UPLOAD] ✗ Failed after ${duration}ms:`, error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error.message || "Failed to complete upload",
    };
    return json(errorResponse, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
