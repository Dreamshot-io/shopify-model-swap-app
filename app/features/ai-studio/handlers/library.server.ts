import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { json } from "@remix-run/node";
import db from "../../../db.server";
import { uploadImageToShopify } from "../../../services/file-upload.server";
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
        type: "LIBRARY_SAVED",
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
        type: "LIBRARY_DELETED",
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
          type: "UPLOADED",
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
