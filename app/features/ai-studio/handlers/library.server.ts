import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { json } from "@remix-run/node";
import db from "../../../db.server";
import {
  uploadImageToShopify,
  createStagedUpload,
  finalizeShopifyUpload,
} from "../../../services/file-upload.server";
import { EventType } from "@prisma/client";
import type {
  LibraryActionResponse,
  ActionErrorResponse,
} from "../types";

export async function handleSaveToLibrary(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const imageUrl = String(formData.get("imageUrl") || "");
  const sourceUrl = String(formData.get("sourceUrl") || "");
  const productId = String(formData.get("productId") || "");

  const query = `#graphql
    query GetLibrary($id: ID!) {
      product(id: $id) {
        id
        metafield(namespace: "dreamshot", key: "ai_library") { id value }
      }
    }
  `;
  const qRes = await admin.graphql(query, { variables: { id: productId } });
  const qJson = await qRes.json();
  const current = qJson?.data?.product?.metafield?.value;
  let libraryItems: Array<
    string | { imageUrl: string; sourceUrl?: string | null }
  > = [];
  try {
    libraryItems = current ? JSON.parse(current) : [];
  } catch {
    libraryItems = [];
  }

  const exists = libraryItems.some((item: any) =>
    typeof item === "string" ? item === imageUrl : item?.imageUrl === imageUrl,
  );
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

  libraryItems.push({ imageUrl, sourceUrl: sourceUrl || null });

  const setMutation = `#graphql
    mutation SetLibrary($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId,
        namespace: "dreamshot",
        key: "ai_library",
        type: "json",
        value: $value
      }]) {
        userErrors { field message }
      }
    }
  `;
  const sRes = await admin.graphql(setMutation, {
    variables: { ownerId: productId, value: JSON.stringify(libraryItems) },
  });
  const sJson = await sRes.json();
  const uErr = sJson?.data?.metafieldsSet?.userErrors;
  if (uErr && uErr.length) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: uErr[0].message,
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await db.metricEvent.create({
      data: {
        id: crypto.randomUUID(),
        shop,
        type: EventType.GENERATED,
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
}

export async function handleDeleteFromLibrary(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const imageUrl = String(formData.get("imageUrl") || "");
  const productId = String(formData.get("productId") || "");

  const query = `#graphql
    query GetLibrary($id: ID!) {
      product(id: $id) {
        id
        metafield(namespace: "dreamshot", key: "ai_library") { id value }
      }
    }
  `;
  const qRes = await admin.graphql(query, { variables: { id: productId } });
  const qJson = await qRes.json();
  const current = qJson?.data?.product?.metafield?.value;
  let libraryItems: Array<
    string | { imageUrl: string; sourceUrl?: string | null }
  > = [];
  try {
    libraryItems = current ? JSON.parse(current) : [];
  } catch {
    libraryItems = [];
  }

  const filtered = libraryItems.filter((item: any) =>
    typeof item === "string" ? item !== imageUrl : item?.imageUrl !== imageUrl,
  );

  const setMutation = `#graphql
    mutation SetLibrary($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId,
        namespace: "dreamshot",
        key: "ai_library",
        type: "json",
        value: $value
      }]) {
        userErrors { field message }
      }
    }
  `;
  const sRes = await admin.graphql(setMutation, {
    variables: { ownerId: productId, value: JSON.stringify(filtered) },
  });
  const sJson = await sRes.json();
  const uErr = sJson?.data?.metafieldsSet?.userErrors;
  if (uErr && uErr.length) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: uErr[0].message,
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await db.metricEvent.create({
      data: {
        id: crypto.randomUUID(),
        shop,
        type: EventType.DRAFT_DELETED,
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
}

export async function handleUpload(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const startTime = Date.now();
  console.log("[UPLOAD:SERVER] Handler called - shop:", shop);

  const file = formData.get("file") as File;
  const productId = String(formData.get("productId") || "");

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

  try {
    console.log("[UPLOAD:SERVER] Step 1/4: Uploading to Shopify...");
    const uploadedFile = await uploadImageToShopify(
      admin,
      file,
      `AI Studio upload - ${new Date().toISOString()}`,
    );
    console.log("[UPLOAD:SERVER] Step 1/4: ✓ Uploaded to Shopify:", uploadedFile.url);

    console.log("[UPLOAD:SERVER] Step 2/4: Fetching current library...");
    const query = `#graphql
      query GetLibrary($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "dreamshot", key: "ai_library") {
            id
            value
          }
        }
      }
    `;

    const qRes = await admin.graphql(query, {
      variables: { id: productId },
    });
    const qJson = await qRes.json();

    const current = qJson?.data?.product?.metafield?.value;
    let libraryItems: Array<
      string | { imageUrl: string; sourceUrl?: string | null }
    > = [];
    try {
      libraryItems = current ? JSON.parse(current) : [];
      console.log("[UPLOAD:SERVER] Step 2/4: ✓ Current library has", libraryItems.length, "items");
    } catch {
      libraryItems = [];
      console.log("[UPLOAD:SERVER] Step 2/4: ✓ No existing library, starting fresh");
    }

    libraryItems.push({
      imageUrl: uploadedFile.url,
      sourceUrl: null,
    });
    console.log("[UPLOAD:SERVER] Step 3/4: Updating library metafield...");

    const setMutation = `#graphql
      mutation SetLibrary($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId,
          namespace: "dreamshot",
          key: "ai_library",
          type: "json",
          value: $value
        }]) {
          metafields { id }
          userErrors { field message }
        }
      }
    `;

    const setRes = await admin.graphql(setMutation, {
      variables: {
        ownerId: productId,
        value: JSON.stringify(libraryItems),
      },
    });

    const setJson = await setRes.json();

    if (setJson?.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("[UPLOAD:SERVER] ✗ Metafield update failed:", setJson.data.metafieldsSet.userErrors);
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: setJson.data.metafieldsSet.userErrors[0].message,
      };
      return json(errorResponse, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[UPLOAD:SERVER] Step 3/4: ✓ Metafield updated, now has", libraryItems.length, "items");

    console.log("[UPLOAD:SERVER] Step 4/4: Logging metric event...");
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          type: EventType.UPLOADED,
          productId,
          imageUrl: uploadedFile.url,
        },
      });
      console.log("[UPLOAD:SERVER] Step 4/4: ✓ Metric event logged");
    } catch (loggingError) {
      console.warn("[UPLOAD:SERVER] Step 4/4: ⚠ Failed to log upload event:", loggingError);
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
  const startTime = Date.now();
  console.log("[COMPLETE_UPLOAD] Handler called - shop:", shop);

  const resourceUrl = String(formData.get("resourceUrl") || "");
  const filename = String(formData.get("filename") || "");
  const productId = String(formData.get("productId") || "");

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

  try {
    console.log("[COMPLETE_UPLOAD] Step 1/3: Finalizing Shopify upload...");
    const uploadedFile = await finalizeShopifyUpload(
      admin,
      resourceUrl,
      filename,
      `AI Studio upload - ${new Date().toISOString()}`,
    );
    console.log("[COMPLETE_UPLOAD] Step 1/3: ✓ Finalized:", uploadedFile.url);

    console.log("[COMPLETE_UPLOAD] Step 2/3: Fetching current library...");
    const query = `#graphql
      query GetLibrary($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "dreamshot", key: "ai_library") {
            id
            value
          }
        }
      }
    `;

    const qRes = await admin.graphql(query, {
      variables: { id: productId },
    });
    const qJson = await qRes.json();

    const current = qJson?.data?.product?.metafield?.value;
    let libraryItems: Array<
      string | { imageUrl: string; sourceUrl?: string | null }
    > = [];
    try {
      libraryItems = current ? JSON.parse(current) : [];
      console.log("[COMPLETE_UPLOAD] Step 2/3: ✓ Current library has", libraryItems.length, "items");
    } catch {
      libraryItems = [];
      console.log("[COMPLETE_UPLOAD] Step 2/3: ✓ No existing library, starting fresh");
    }

    libraryItems.push({
      imageUrl: uploadedFile.url,
      sourceUrl: null,
    });

    console.log("[COMPLETE_UPLOAD] Step 3/3: Updating library metafield...");
    const setMutation = `#graphql
      mutation SetLibrary($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId,
          namespace: "dreamshot",
          key: "ai_library",
          type: "json",
          value: $value
        }]) {
          metafields { id }
          userErrors { field message }
        }
      }
    `;

    const setRes = await admin.graphql(setMutation, {
      variables: {
        ownerId: productId,
        value: JSON.stringify(libraryItems),
      },
    });

    const setJson = await setRes.json();

    if (setJson?.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("[COMPLETE_UPLOAD] ✗ Metafield update failed:", setJson.data.metafieldsSet.userErrors);
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: setJson.data.metafieldsSet.userErrors[0].message,
      };
      return json(errorResponse, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[COMPLETE_UPLOAD] Step 3/3: ✓ Metafield updated, now has", libraryItems.length, "items");

    // Log metric event
    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          type: EventType.UPLOADED,
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
