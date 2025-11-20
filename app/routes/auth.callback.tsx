import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[auth.callback] OAuth callback handler");
  await authenticate.admin(request);
  return null;
};
