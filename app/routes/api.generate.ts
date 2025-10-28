import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleGenerate } from "../features/ai-studio/handlers/generation.server";
import { checkAIProviderHealth } from "../services/ai-providers.server";
import type { ActionErrorResponse } from "../features/ai-studio/types";

/**
 * Resource route for AI image generation API
 * No default export = resource route (returns JSON, no HTML)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[API.GENERATE:${requestId}] Request received`);

  try {
    // Authenticate
    const { session } = await authenticate.admin(request);
    console.log(`[API.GENERATE:${requestId}] Authenticated - shop: ${session.shop}`);

    // Parse form data
    const formData = await request.formData();
    const productId = String(formData.get("productId") || "");

    console.log(`[API.GENERATE:${requestId}] Generating for product: ${productId}`);

    // Check AI service health
    const healthCheck = checkAIProviderHealth();
    if (!healthCheck.healthy) {
      const errorResponse: ActionErrorResponse = {
        ok: false,
        error: `AI service unavailable: ${healthCheck.error}`,
      };
      return json(errorResponse, {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate image
    const result = await handleGenerate(formData, session.shop);
    console.log(`[API.GENERATE:${requestId}] Generation complete`);

    return result;
  } catch (error: any) {
    console.error(`[API.GENERATE:${requestId}] Error:`, error);

    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error?.message || "Generation failed",
      debug:
        process.env.NODE_ENV === "development"
          ? { message: error.message, stack: error.stack }
          : undefined,
    };

    return json(errorResponse, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
