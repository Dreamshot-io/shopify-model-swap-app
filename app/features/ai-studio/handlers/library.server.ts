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
    return json(duplicateResponse);
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
    return json(errorResponse, { status: 400 });
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
  return json(successResponse);
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
    return json(errorResponse, { status: 400 });
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
  return json(successResponse);
}

export async function handleUpload(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const file = formData.get("file") as File;
  const productId = String(formData.get("productId") || "");

  if (!file || !file.size) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "No file provided",
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    const uploadedFile = await uploadImageToShopify(
      admin,
      file,
      `AI Studio upload - ${new Date().toISOString()}`,
    );

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
    } catch {
      libraryItems = [];
    }

    libraryItems.push({
      imageUrl: uploadedFile.url,
      sourceUrl: null,
    });

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
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: setJson.data.metafieldsSet.userErrors[0].message,
      };
      return json(errorResponse, { status: 400 });
    }

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
    } catch (loggingError) {
      console.warn("Failed to log upload event:", loggingError);
    }

    const successResponse: LibraryActionResponse & { imageUrl: string } = {
      ok: true,
      savedToLibrary: true,
      imageUrl: uploadedFile.url,
    };
    return json(successResponse);
  } catch (error: any) {
    console.error("Upload failed:", error);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error.message || "Upload failed",
    };
    return json(errorResponse, { status: 500 });
  }
}
