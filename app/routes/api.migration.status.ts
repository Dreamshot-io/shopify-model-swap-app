/**
 * API endpoint for getting migration status
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { R2MigrationService } from "../services/r2-migration.server";
import { CompatibilityRotationService } from "../services/compatibility-rotation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);

    // Get migration service
    const migrationService = new R2MigrationService(admin, db);
    const compatibilityService = new CompatibilityRotationService(admin, db);

    // Get migration report
    const migrationStatus = await migrationService.getMigrationReport();

    // Get system stats
    const systemStats = await compatibilityService.getSystemStats();

    return json({
      migrationStatus,
      systemStats,
    });
  } catch (error) {
    console.error("Error getting migration status:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};