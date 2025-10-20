import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

/**
 * Debug route to check session storage
 * Access via: https://your-app.vercel.app/debug/sessions
 *
 * SECURITY: Remove this route in production or add authentication
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopFilter = url.searchParams.get("shop");

  console.log("[debug.sessions] Fetching sessions");
  console.log("[debug.sessions] Shop filter:", shopFilter);

  try {
    const sessions = await db.session.findMany({
      where: shopFilter ? { shop: shopFilter } : undefined,
      select: {
        id: true,
        shop: true,
        isOnline: true,
        scope: true,
        expires: true,
        userId: true,
        email: true,
        accountOwner: true,
        // Don't expose accessToken for security
      },
      orderBy: {
        shop: "asc",
      },
      take: 50, // Limit to prevent overwhelming response
    });

    console.log("[debug.sessions] Found", sessions.length, "sessions");

    return json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        count: sessions.length,
        sessions: sessions,
        message: "Session data retrieved successfully",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("[debug.sessions] Error fetching sessions:", error);
    return json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
};
