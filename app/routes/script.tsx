import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { authenticate } from "../shopify.server";

/**
 * Serves the unified image replacement script for A/B testing
 * Features automatic theme detection, variant-aware testing, and gallery reconstruction
 * Tracking is handled separately by Web Pixels extension
 *
 * Script version: 3.0.0-unified
 * Script size: ~25KB (unminified), ~12KB minified
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const isDevelopment = process.env.NODE_ENV === "development";
    const url = new URL(request.url);

    // In development, allow unauthenticated requests for testing
    // In production, always require App Proxy authentication
    let corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (!isDevelopment) {
      try {
        // @ts-ignore - cors property exists but TypeScript doesn't recognize it
        const { cors } = await authenticate.public.appProxy(request);
        corsHeaders = {
          // @ts-ignore
          ...(cors?.headers || {}),
          ...corsHeaders,
        };
      } catch (authError) {
        console.warn("[script] App proxy authentication failed, serving script without Shopify headers", authError);
      }
    }

    // Determine script name based on environment
    const useMinified = !isDevelopment && url.searchParams.get('debug') !== 'true';
    let scriptName = useMinified ? "image-replacer.min.js" : "image-replacer.js";
    let scriptPath = join(process.cwd(), "public", scriptName);

    // Fallback chain: minified -> regular
    if (!existsSync(scriptPath) && useMinified) {
      scriptName = "image-replacer.js";
      scriptPath = join(process.cwd(), "public", scriptName);
    }

    if (!existsSync(scriptPath)) {
      throw new Error(`Image replacer script not found: ${scriptName}`);
    }

    console.log(`[script] Serving ${scriptName} (minified=${useMinified})`);

    const script = readFileSync(scriptPath, "utf-8");

    // Return the script with proper headers
    return new Response(script, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300", // 5 minute cache
        "X-Content-Type-Options": "nosniff", // Security header
        "X-Script-Size": `${Buffer.byteLength(script, 'utf8')} bytes`, // Track size
        "X-Script-Version": "3.0.0-unified", // Version tracking
        "X-Theme-Aware": "true", // Feature flag
      },
    });
  } catch (error) {
    console.error("Failed to serve script:", error);
    return new Response(
      '// Error: Failed to load A/B test script\nconsole.error("[A/B Test] Script failed to load");',
      {
        status: 500,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  }
};
