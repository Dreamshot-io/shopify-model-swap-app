/**
 * API endpoint for triggering migrations
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { R2MigrationService } from "../services/r2-migration.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);

    // Parse form data
    const formData = await request.formData();
    const action = formData.get("action") as string;
    const testId = formData.get("testId") as string | null;

    // Get migration service
    const migrationService = new R2MigrationService(admin, db);

    let result: any;
    let message = "";

    switch (action) {
      case "migrate_all":
        console.log("[Migration] Starting full migration");
        result = await migrationService.migrateAllTests();
        message = `Migration started: ${result.migratedTests} completed, ${result.failedTests} failed, ${result.pendingTests} pending`;
        break;

      case "retry_failed":
        console.log("[Migration] Retrying failed migrations");
        result = await migrationService.retryFailedMigrations();
        message = `Retry completed: ${result.migratedTests} succeeded, ${result.failedTests} still failed`;
        break;

      case "migrate_single":
        if (!testId) {
          return json(
            { error: "Test ID required for single migration" },
            { status: 400 }
          );
        }
        console.log(`[Migration] Migrating single test: ${testId}`);
        result = await migrationService.migrateTest(testId);
        message = result.status === "completed"
          ? `Test ${testId} migrated successfully`
          : `Test ${testId} migration failed: ${result.error}`;
        break;

      default:
        return json(
          { error: `Invalid action: ${action}` },
          { status: 400 }
        );
    }

    // Get updated status
    const migrationStatus = await migrationService.getMigrationReport();

    return json({
      success: true,
      message,
      migrationStatus,
      result,
    });
  } catch (error) {
    console.error("Error during migration:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};