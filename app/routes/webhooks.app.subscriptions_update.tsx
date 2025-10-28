import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // You can inspect payload to react to plan changes if needed
  // For now, nothing to persist because billing checks call Shopify each time.
  return new Response();
};
