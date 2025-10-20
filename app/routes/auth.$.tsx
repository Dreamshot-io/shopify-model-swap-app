import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("[auth.$] OAuth callback called");
  console.log("[auth.$] Full URL:", request.url);
  console.log("[auth.$] Search params:", url.searchParams.toString());
  console.log("[auth.$] Path:", url.pathname);
  console.log("[auth.$] Shop param:", url.searchParams.get("shop"));
  console.log("[auth.$] Host param:", url.searchParams.get("host"));

  try {
    const result = await authenticate.admin(request);
    console.log("[auth.$] Authentication successful");
    console.log("[auth.$] Session shop:", result.session?.shop);
    console.log("[auth.$] Session ID:", result.session?.id);
    console.log("[auth.$] Session isOnline:", result.session?.isOnline);
  } catch (error) {
    console.error("[auth.$] Authentication failed:", error);
    throw error;
  }

  return null;
};
