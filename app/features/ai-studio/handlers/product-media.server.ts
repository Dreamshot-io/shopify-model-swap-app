import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { json } from "@remix-run/node";
import db from "../../../db.server";
import type {
  PublishImageResponse,
  LibraryActionResponse,
  ActionErrorResponse,
} from "../types";

export async function handlePublish(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const imageUrl = String(formData.get("imageUrl") || "");
  const productId = String(formData.get("productId") || "");

  const mutation = `
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message code }
      }
    }
  `;
  const resp = await admin.graphql(mutation, {
    variables: {
      productId,
      media: [
        {
          originalSource: imageUrl,
          mediaContentType: "IMAGE",
          alt: "AI generated image",
        },
      ],
    },
  });
  const jsonRes = await resp.json();
  const errors = jsonRes?.data?.productCreateMedia?.mediaUserErrors;
  if (errors && errors.length) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: errors[0].message,
      debug: errors,
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    await db.metricEvent.create({
      data: {
        id: crypto.randomUUID(),
        shop,
        type: "PUBLISHED",
        productId,
        imageUrl,
      },
    });
  } catch {}

  const successResponse: PublishImageResponse = {
    ok: true,
    published: true,
  };
  return json(successResponse);
}

export async function handleDeleteFromProduct(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const mediaId = String(formData.get("mediaId") || "");
  const productId = String(formData.get("productId") || "");

  if (!mediaId) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing mediaId",
    };
    return json(errorResponse, { status: 400 });
  }

  const deleteMutation = `#graphql
    mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors {
          field
          message
          code
        }
        product {
          id
        }
      }
    }
  `;

  const deleteRes = await admin.graphql(deleteMutation, {
    variables: {
      productId,
      mediaIds: [mediaId],
    },
  });

  const deleteJson = await deleteRes.json();
  const errors = deleteJson?.data?.productDeleteMedia?.mediaUserErrors;

  if (errors && errors.length > 0) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: errors[0].message,
      debug: errors,
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    await db.metricEvent.create({
      data: {
        id: crypto.randomUUID(),
        shop,
        type: "MEDIA_DELETED",
        productId,
      },
    });
  } catch {}

  const successResponse: LibraryActionResponse = {
    ok: true,
    deletedFromProduct: true,
  };
  return json(successResponse);
}
