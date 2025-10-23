import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleUpload } from "../features/ai-studio/handlers/library.server";

/**
 * Resource route that stores an already-uploaded image into the library metafield.
 * (Used when the client opts for the server-managed upload path.)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[APP.API.AI-STUDIO.UPLOAD:${requestId}] Request received`);

  try {
    const formData = await request.formData();
    const { admin, session } = await authenticate.admin(request);
    console.log(
      `[APP.API.AI-STUDIO.UPLOAD:${requestId}] Authenticated - shop: ${session.shop}`,
    );

    return await handleUpload(formData, admin, session.shop);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error(`[APP.API.AI-STUDIO.UPLOAD:${requestId}] Failed:`, error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
};
