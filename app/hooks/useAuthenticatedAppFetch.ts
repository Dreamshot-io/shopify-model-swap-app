import { useMemo } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Hook that returns a fetch wrapper tied to the embedded Shopify session.
 * In App Bridge 4.x, the global fetch is automatically authenticated.
 * We just need to ensure requests are routed to the app origin.
 */
export function useAuthenticatedAppFetch() {
  const shopify = useAppBridge();

  return useMemo(() => {
    const appOrigin = (window.ENV && window.ENV.SHOPIFY_APP_URL) || window.location.origin;

    return async (input: string | URL, init?: RequestInit) => {
      const target =
        typeof input === "string" || input instanceof URL
          ? input
          : String(input);

      const absoluteUrl = new URL(target.toString(), appOrigin).toString();

      // In App Bridge 4.x, global fetch is automatically authenticated
      return fetch(absoluteUrl, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Accept: init?.headers?.Accept ?? "application/json",
        },
      });
    };
  }, [shopify]);
}
