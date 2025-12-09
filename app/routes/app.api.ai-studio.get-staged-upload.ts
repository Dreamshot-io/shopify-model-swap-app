import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleGetStagedUpload } from "../features/ai-studio/handlers/library.server";

/**
 * Resource route that returns a staged upload target for Shopify direct uploads.
 * Always responds with JSON – never falls back to the document loader.
 */
export const maxDuration = 30; // 30 seconds should be enough for getting staged URL

export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[APP.API.AI-STUDIO.GET-STAGED:${requestId}] Request received`);

  try {
    const formData = await request.formData();
    const { admin, session } = await authenticate.admin(request);
    console.log(
      `[APP.API.AI-STUDIO.GET-STAGED:${requestId}] Authenticated - shop: ${session.shop}`,
    );

    return await handleGetStagedUpload(formData, admin, session.shop);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error(`[APP.API.AI-STUDIO.GET-STAGED:${requestId}] Failed:`, error);
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create staged upload",
      },
      { status: 500 },
    );
  }
};
