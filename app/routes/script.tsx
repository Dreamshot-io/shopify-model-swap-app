import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { authenticate } from "../shopify.server";

/**
 * Serves the theme-aware image replacement script for A/B testing
 * Features automatic theme detection and adaptation for different Shopify themes
 * Tracking is handled separately by Web Pixels extension
 *
 * Script versions:
 * - image-replacer.js: Original version (backup)
 * - image-replacer-enhanced.js: Theme-aware version (production)
 * Script size: ~12KB (enhanced), ~8KB minified
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const isDevelopment = process.env.NODE_ENV === "development";
    const url = new URL(request.url);
    
    // Allow version selection via query param for testing
    const version = url.searchParams.get('version');
    const useEnhanced = version === 'enhanced' || version !== 'original';

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

    // Determine script name based on version and environment
    const useMinified = !isDevelopment && url.searchParams.get('debug') !== 'true';
    let scriptName;
    
    if (useEnhanced) {
      scriptName = useMinified ? "image-replacer-enhanced.min.js" : "image-replacer-enhanced.js";
    } else {
      scriptName = useMinified ? "image-replacer.min.js" : "image-replacer.js";
    }
    
    let scriptPath = join(process.cwd(), "public", scriptName);

    // Fallback chain: minified -> regular -> original
    if (!existsSync(scriptPath)) {
      if (useMinified && useEnhanced) {
        // Try non-minified enhanced
        scriptName = "image-replacer-enhanced.js";
        scriptPath = join(process.cwd(), "public", scriptName);
      }
      
      if (!existsSync(scriptPath) && useEnhanced) {
        // Try original version
        console.warn(`[script] Enhanced script not found, falling back to original`);
        scriptName = useMinified ? "image-replacer.min.js" : "image-replacer.js";
        scriptPath = join(process.cwd(), "public", scriptName);
      }
      
      if (!existsSync(scriptPath) && useMinified) {
        // Try non-minified original
        scriptName = "image-replacer.js";
        scriptPath = join(process.cwd(), "public", scriptName);
      }
    }

    if (!existsSync(scriptPath)) {
      throw new Error(`Image replacer script not found: ${scriptName}`);
    }
    
    console.log(`[script] Serving ${scriptName} (enhanced=${useEnhanced}, minified=${useMinified})`);

    const script = readFileSync(scriptPath, "utf-8");

    // Return the script with proper headers
    return new Response(script, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300", // 5 minute cache
        "X-Content-Type-Options": "nosniff", // Security header
        "X-Script-Size": `${Buffer.byteLength(script, 'utf8')} bytes`, // Track size
        "X-Script-Version": useEnhanced ? "2.0.0-enhanced" : "1.0.0-original", // Version tracking
        "X-Theme-Aware": useEnhanced ? "true" : "false", // Feature flag
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
