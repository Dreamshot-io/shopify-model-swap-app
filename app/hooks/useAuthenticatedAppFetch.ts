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
        // Safely detect FormData without relying on instanceof
        // FormData may not be available in all contexts (e.g., Shopify embedded iframe)
        const isFormData = (body: any): body is FormData => {
          if (!body) return false;
          if (typeof FormData !== 'undefined' && body instanceof FormData) {
            return true;
          }
          // Fallback: check for FormData-like object (has append method and constructor name)
          return (
            typeof body === 'object' &&
            typeof body.append === 'function' &&
            typeof body.constructor === 'function' &&
            (body.constructor.name === 'FormData' || body.constructor.name === 'formdata')
          );
        };

        // In App Bridge 4.x, global fetch is automatically authenticated
        // Ensure credentials are included for same-origin requests
        const response = await fetch(absoluteUrl, {
          ...init,
          credentials: 'include', // Ensure cookies are sent with the request
          headers: {
            // Only set Accept if not already set and not sending FormData
            ...(init?.headers || {}),
            ...(isFormData(init?.body)
              ? {} // Don't override headers for FormData - let browser set Content-Type
              : { Accept: init?.headers?.Accept ?? "application/json" }
            ),
          },
        });

        console.log("[AUTH_FETCH] Response:", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        });

        // Handle authentication failures
        if (response.status === 401 || response.status === 403) {
          console.error("[AUTH_FETCH] Authentication failed - session may have expired");
          // The response might be a redirect, check for that
          if (response.headers.get('X-Shopify-API-Request-Failure-Reauthorize') === '1') {
            console.error("[AUTH_FETCH] Shopify requests reauthorization");
          }
        }

        return response;
      } catch (error) {
        console.error("[AUTH_FETCH] Request failed:", error);
        throw error;
      }
    };
  }, []);
}
