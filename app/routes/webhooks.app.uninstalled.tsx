import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { findShopCredential } from "../services/shops.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for ${shop}`);

  // Clean up sessions
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // If public installation, remove ShopCredential from database
  try {
    const credential = await findShopCredential({ shopDomain: shop });
    if (credential?.mode === 'PUBLIC') {
      console.log(`[webhook] Removing public installation: ${shop}`);
      await db.shopCredential.delete({ where: { id: credential.id } });
    } else {
      console.log(`[webhook] Private installation uninstalled, keeping credentials: ${shop}`);
    }
  } catch (error) {
    console.error(`[webhook] Error handling uninstall for ${shop}:`, error);
  }

  return new Response();
};
