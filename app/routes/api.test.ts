import { json } from "@remix-run/node";

/**
 * Test endpoint to verify API routes work
 */
export async function action() {
  console.log("🧪 TEST ENDPOINT HIT!");
  return json({
    ok: true,
    message: "API route working!",
    timestamp: new Date().toISOString()
  });
}

export async function loader() {
  console.log("🧪 TEST ENDPOINT HIT (GET)!");
  return json({
    ok: true,
    message: "API route working! (GET)",
    timestamp: new Date().toISOString()
  });
}
