import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleCompleteUpload } from "../features/ai-studio/handlers/library.server";

/**
 * Resource route that finalizes a Shopify staged upload and persists it to the library.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[APP.API.AI-STUDIO.COMPLETE:${requestId}] Request received`);

  try {
    const formData = await request.formData();
    const { admin, session } = await authenticate.admin(request);
    console.log(
      `[APP.API.AI-STUDIO.COMPLETE:${requestId}] Authenticated - shop: ${session.shop}`,
    );

    return await handleCompleteUpload(formData, admin, session.shop);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error(`[APP.API.AI-STUDIO.COMPLETE:${requestId}] Failed:`, error);
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to finalize upload",
      },
      { status: 500 },
    );
  }
};

