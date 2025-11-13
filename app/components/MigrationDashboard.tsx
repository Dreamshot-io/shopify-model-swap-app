/**
 * MigrationDashboard provides a UI for monitoring and controlling the
 * R2 to Shopify Gallery migration process.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Text,
  Button,
  ProgressBar,
  Badge,
  Banner,
  Layout,
  Page,
  DataTable,
  BlockStack,
  ButtonGroup,
  Icon,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import {
  CheckIcon,
  XIcon,
  RefreshIcon,
  PlayIcon,
  AlertTriangleIcon,
} from "@shopify/polaris-icons";
import { useFetcher } from "@remix-run/react";

interface MigrationStatus {
  totalTests: number;
  migratedTests: number;
  failedTests: number;
  pendingTests: number;
  errors: Array<{ testId: string; error: string }>;
}

interface SystemStats {
  totalTests: number;
  v2Ready: number;
  v1Only: number;
  needsMigration: number;
  migrationProgress: number;
}

export function MigrationDashboard() {
  const fetcher = useFetcher<{
    migrationStatus?: MigrationStatus;
    systemStats?: SystemStats;
    message?: string;
    error?: string;
  }>();

  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Auto-refresh every 5 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetcher.load("/api/migration/status");
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Load initial status
  useEffect(() => {
    fetcher.load("/api/migration/status");
  }, []);

  const handleStartMigration = useCallback(() => {
    setIsLoading(true);
    fetcher.submit(
      { action: "migrate_all" },
      { method: "post", action: "/api/migration/migrate" }
    );
  }, []);

  const handleRetryFailed = useCallback(() => {
    setIsLoading(true);
    fetcher.submit(
      { action: "retry_failed" },
      { method: "post", action: "/api/migration/migrate" }
    );
  }, []);

  const handleMigrateTest = useCallback((testId: string) => {
    fetcher.submit(
      { action: "migrate_single", testId },
      { method: "post", action: "/api/migration/migrate" }
    );
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle") {
      setIsLoading(false);
    }
  }, [fetcher.state]);

  const migrationStatus = fetcher.data?.migrationStatus;
  const systemStats = fetcher.data?.systemStats;

  const progressPercent = migrationStatus
    ? (migrationStatus.migratedTests / migrationStatus.totalTests) * 100
    : 0;

  const getStatusBadge = () => {
    if (!migrationStatus) return null;

    if (migrationStatus.failedTests > 0) {
      return <Badge tone="warning">Needs Attention</Badge>;
    }

    if (progressPercent === 100) {
      return <Badge tone="success">Completed</Badge>;
    }

    if (progressPercent > 0) {
      return <Badge tone="info">In Progress</Badge>;
    }

    return <Badge>Not Started</Badge>;
  };

  const errorRows = migrationStatus?.errors?.map((error, index) => [
    error.testId,
    <Text as="span" variant="bodyMd" tone="critical">
      {error.error}
    </Text>,
    <Button size="slim" onClick={() => handleMigrateTest(error.testId)}>
      Retry
    </Button>,
  ]) || [];

  return (
    <Page
      title="R2 to Gallery Migration"
      subtitle="Migrate images from R2 storage to Shopify's native media gallery"
      primaryAction={{
        content: "Start Full Migration",
        onAction: handleStartMigration,
        loading: isLoading,
        disabled: progressPercent === 100,
      }}
      secondaryActions={[
        {
          content: autoRefresh ? "Stop Auto-Refresh" : "Start Auto-Refresh",
          onAction: () => setAutoRefresh(!autoRefresh),
        },
        {
          content: "Refresh Status",
          onAction: () => fetcher.load("/api/migration/status"),
          icon: RefreshIcon,
        },
      ]}
    >
      <Layout>
        {fetcher.data?.message && (
          <Layout.Section>
            <Banner
              title="Migration Update"
              tone="success"
              onDismiss={() => {}}
            >
              <p>{fetcher.data.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {fetcher.data?.error && (
          <Layout.Section>
            <Banner
              title="Migration Error"
              tone="critical"
              onDismiss={() => {}}
            >
              <p>{fetcher.data.error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="500">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Migration Progress
                  </Text>
                  {getStatusBadge()}
                </InlineStack>

                <ProgressBar
                  progress={progressPercent}
                  size="medium"
                  tone={migrationStatus?.failedTests ? "warning" : "primary"}
                />

                <InlineStack gap="800">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Total Tests
                    </Text>
                    <Text variant="headingLg" as="p">
                      {migrationStatus?.totalTests || 0}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Migrated
                    </Text>
                    <InlineStack gap="200" align="start">
                      <Text variant="headingLg" as="p" tone="success">
                        {migrationStatus?.migratedTests || 0}
                      </Text>
                      {migrationStatus?.migratedTests > 0 && (
                        <Icon source={CheckIcon} tone="success" />
                      )}
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Pending
                    </Text>
                    <Text variant="headingLg" as="p">
                      {migrationStatus?.pendingTests || 0}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Failed
                    </Text>
                    <InlineStack gap="200" align="start">
                      <Text variant="headingLg" as="p" tone="critical">
                        {migrationStatus?.failedTests || 0}
                      </Text>
                      {migrationStatus?.failedTests > 0 && (
                        <Icon source={XIcon} tone="critical" />
                      )}
                    </InlineStack>
                  </BlockStack>
                </InlineStack>

                {migrationStatus?.failedTests > 0 && (
                  <>
                    <Divider />
                    <Button
                      onClick={handleRetryFailed}
                      loading={isLoading}
                      icon={RefreshIcon}
                    >
                      Retry All Failed ({migrationStatus.failedTests})
                    </Button>
                  </>
                )}
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {systemStats && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="500">
                  <Text variant="headingMd" as="h2">
                    System Statistics
                  </Text>

                  <InlineStack gap="800">
                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        V2 Ready (Gallery)
                      </Text>
                      <InlineStack gap="200" align="start">
                        <Text variant="headingLg" as="p" tone="success">
                          {systemStats.v2Ready}
                        </Text>
                        <Badge tone="success">Fast</Badge>
                      </InlineStack>
                    </BlockStack>

                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        V1 Only (R2)
                      </Text>
                      <InlineStack gap="200" align="start">
                        <Text variant="headingLg" as="p" tone="warning">
                          {systemStats.v1Only}
                        </Text>
                        <Badge tone="warning">Slow</Badge>
                      </InlineStack>
                    </BlockStack>

                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        Migration Progress
                      </Text>
                      <Text variant="headingLg" as="p">
                        {systemStats.migrationProgress.toFixed(1)}%
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  {systemStats.v1Only > 0 && (
                    <Banner tone="info">
                      <p>
                        {systemStats.v1Only} tests are still using the legacy R2 storage system.
                        These tests will experience slower rotation times until migrated.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}

        {errorRows.length > 0 && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="500">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">
                      Failed Migrations
                    </Text>
                    <Icon source={AlertTriangleIcon} tone="warning" />
                  </InlineStack>

                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Test ID", "Error", "Action"]}
                    rows={errorRows}
                  />
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="500">
                <Text variant="headingMd" as="h2">
                  Migration Benefits
                </Text>

                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Icon source={CheckIcon} tone="success" />
                    <Text variant="bodyMd">
                      <strong>35x faster rotations</strong> - From ~105 seconds to ~3 seconds
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Icon source={CheckIcon} tone="success" />
                    <Text variant="bodyMd">
                      <strong>Zero image loss</strong> - Images never deleted, only reassigned
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Icon source={CheckIcon} tone="success" />
                    <Text variant="bodyMd">
                      <strong>Cost savings</strong> - Eliminate $50/month R2 storage costs
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Icon source={CheckIcon} tone="success" />
                    <Text variant="bodyMd">
                      <strong>Improved reliability</strong> - No external dependencies or network failures
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}