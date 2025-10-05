import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Health check endpoint for app proxy verification
 *
 * Access via: https://{shop-domain}/apps/model-swap/health
 *
 * Returns:
 * - status: "healthy" if app proxy is working
 * - shop: The shop domain (from authenticated session)
 * - timestamp: Current server time
 * - proxy: "working" confirmation
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, cors } = await authenticate.public.appProxy(request);

    return json({
      status: "healthy",
      shop: session?.shop || "unknown",
      timestamp: new Date().toISOString(),
      proxy: "working",
      message: "App proxy is configured correctly and HMAC validation passed"
    }, {
      headers: cors.headers
    });
  } catch (error) {
    console.error("Health check failed:", error);

    return json({
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
      proxy: "failing"
    }, {
      status: 500
    });
  }
};
