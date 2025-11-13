/**
 * Route for the R2 to Gallery Migration Dashboard
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { MigrationDashboard } from "../components/MigrationDashboard";
import db from "../db.server";
import { CompatibilityRotationService } from "../services/compatibility-rotation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Get initial system stats
  const compatibilityService = new CompatibilityRotationService(admin, db);
  const systemStats = await compatibilityService.getSystemStats();

  return json({
    shop: session.shop,
    systemStats,
  });
};

export default function MigrationPage() {
  const data = useLoaderData<typeof loader>();

  return <MigrationDashboard />;
}