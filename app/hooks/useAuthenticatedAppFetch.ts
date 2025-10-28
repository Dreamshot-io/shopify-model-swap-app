import { useMemo } from "react";

/**
 * Hook that returns a fetch wrapper tied to the embedded Shopify session.
 * In App Bridge 4.x, the global fetch is automatically authenticated.
 * We just need to ensure requests are routed to the app origin.
 */
export function useAuthenticatedAppFetch() {
  return useMemo(() => {
    // SSR guard - window is not available during server-side rendering
    if (typeof window === 'undefined') {
      return async () => {
        throw new Error('useAuthenticatedAppFetch can only be used on the client side');
      };
    }

    const appOrigin = (window.ENV && window.ENV.SHOPIFY_APP_URL) || window.location.origin;

    return async (input: string | URL, init?: RequestInit) => {
      const target =
        typeof input === "string" || input instanceof URL
          ? input
          : String(input);

      const absoluteUrl = new URL(target.toString(), appOrigin).toString();

      console.log("[AUTH_FETCH] Making request:", {
        target: target.toString(),
        absoluteUrl,
        appOrigin,
        hasENV: !!(window.ENV && window.ENV.SHOPIFY_APP_URL),
      });

      try {
        // In App Bridge 4.x, global fetch is automatically authenticated
        const response = await fetch(absoluteUrl, {
          ...init,
          headers: {
            // Only set Accept if not already set and not sending FormData
            ...(init?.headers || {}),
            ...(init?.body instanceof FormData
              ? {} // Don't override headers for FormData - let browser set Content-Type
              : { Accept: init?.headers?.Accept ?? "application/json" }
            ),
          },
        });

        console.log("[AUTH_FETCH] Response:", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
        });

        return response;
      } catch (error) {
        console.error("[AUTH_FETCH] Request failed:", error);
        throw error;
      }
    };
  }, []);
}
