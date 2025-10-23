import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { authenticate } from "../shopify.server";

/**
 * Serves the lightweight image replacement script for A/B testing
 * This script runs in the main thread on the storefront to handle image replacement
 * Tracking is handled separately by Web Pixels extension
 *
 * Script size: ~3.5KB minified (under 5KB target)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const isDevelopment = process.env.NODE_ENV === "development";

    // In development, allow unauthenticated requests for testing
    // In production, always require App Proxy authentication
    let corsHeaders = {};

    if (isDevelopment) {
      // Allow CORS for development testing
      corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };
    } else {
      // Authenticate App Proxy request in production
      const { cors } = await authenticate.public.appProxy(request);
      corsHeaders = cors.headers;
    }

    // Use minified version in production, regular version in development for debugging
    const scriptFileName = isDevelopment ? "image-replacer.js" : "image-replacer.min.js";
    const scriptPath = join(process.cwd(), "public", scriptFileName);

    // Fallback to non-minified if minified doesn't exist
    const fallbackPath = join(process.cwd(), "public", "image-replacer.js");

    let script: string;
    if (existsSync(scriptPath)) {
      script = readFileSync(scriptPath, "utf-8");
    } else if (existsSync(fallbackPath)) {
      script = readFileSync(fallbackPath, "utf-8");
    } else {
      throw new Error("No image replacer script found");
    }

    // Return the script with proper headers
    return new Response(script, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300", // 5 minute cache
        "Access-Control-Allow-Origin": "*", // Allow cross-origin for storefronts
        "X-Content-Type-Options": "nosniff", // Security header
        "X-Script-Size": `${Buffer.byteLength(script, 'utf8')} bytes`, // Track size
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
        },
      }
    );
  }
};
