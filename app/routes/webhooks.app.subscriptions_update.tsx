import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  
  console.log(`[Billing Webhook] ${topic} for ${shop}`, {
    subscriptionStatus: payload?.app_subscription?.status,
    plan: payload?.app_subscription?.name,
  });

  // Billing is managed through Shopify Partner Dashboard
  // This webhook receives notifications when merchants subscribe/cancel
  // Add custom logic here if you need to track subscription status in your database

  return new Response();
};
