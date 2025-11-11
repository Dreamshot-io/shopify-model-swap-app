/**
 * Emergency recovery route for lost base images
 *
 * Access this at: /app/recover-base-images
 */

import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { Page, Layout, Card, Button, Banner, Text, BlockStack, InlineStack, Badge } from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { BaseImageRecoveryService } from '../services/recover-base-images.server';
import db from '../db.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  // Get all tests that might need recovery
  const tests = await db.aBTest.findMany({
    where: {
      shop: session.shop,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      productId: true,
      currentCase: true,
      baseImages: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  // Check which ones might need recovery
  const testsWithStatus = tests.map(test => {
    const baseImages = test.baseImages as any[] || [];
    const hasBackups = baseImages.some(img => img?.permanentUrl);
    const needsRecovery = test.currentCase === 'BASE' && hasBackups;

    return {
      ...test,
      baseImageCount: baseImages.length,
      hasBackups,
      needsRecovery,
    };
  });

  return json({
    shop: session.shop,
    tests: testsWithStatus,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const testId = formData.get('testId') as string;
  const recoverAll = formData.get('recoverAll') === 'true';

  if (recoverAll) {
    // Recover all affected tests
    const result = await BaseImageRecoveryService.recoverAllAffectedTests(
      admin,
      session.shop
    );

    return json({
      success: result.recovered > 0,
      message: `Recovered ${result.recovered} out of ${result.totalTests} tests. Failed: ${result.failed}`,
      ...result,
    });
  } else if (testId) {
    // Recover a specific test
    const result = await BaseImageRecoveryService.recoverBaseImages(admin, testId);

    return json({
      success: result.success,
      message: result.success
        ? `Successfully recovered ${result.imagesRecovered} images`
        : `Recovery failed: ${result.error}`,
      ...result,
    });
  }

  return json({
    success: false,
    message: 'No test ID provided',
  });
}

export default function RecoverBaseImages() {
  const { shop, tests } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === 'submitting';

  const testsNeedingRecovery = tests.filter(t => t.needsRecovery);

  return (
    <Page
      title="Emergency Base Image Recovery"
      subtitle="Restore lost base images from R2 backups"
      backAction={{ url: '/app' }}
    >
      <Layout>
        {actionData && (
          <Layout.Section>
            <Banner
              title={actionData.message}
              status={actionData.success ? 'success' : 'critical'}
            />
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Recovery Status
              </Text>

              <Banner status="warning">
                <Text as="p">
                  This tool restores base images that were accidentally deleted due to a rotation bug.
                  Only use this if your base images are missing.
                </Text>
              </Banner>

              <InlineStack gap="400" align="space-between">
                <Text as="p">
                  Shop: <strong>{shop}</strong>
                </Text>
                <Text as="p">
                  Tests needing recovery: <Badge status="warning">{testsNeedingRecovery.length}</Badge>
                </Text>
              </InlineStack>

              {testsNeedingRecovery.length > 0 && (
                <Form method="post">
                  <input type="hidden" name="recoverAll" value="true" />
                  <Button
                    variant="primary"
                    submit
                    loading={isLoading}
                    disabled={isLoading}
                  >
                    Recover All Affected Tests ({testsNeedingRecovery.length})
                  </Button>
                </Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Individual Test Recovery
              </Text>

              <BlockStack gap="300">
                {tests.map((test) => (
                  <Card key={test.id} sectioned>
                    <InlineStack gap="400" align="space-between">
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">
                          {test.name}
                        </Text>
                        <InlineStack gap="200">
                          <Badge status={test.currentCase === 'BASE' ? 'info' : 'default'}>
                            {test.currentCase}
                          </Badge>
                          <Text as="p" variant="bodySm">
                            {test.baseImageCount} base images
                          </Text>
                          {test.hasBackups && (
                            <Badge status="success">Has backups</Badge>
                          )}
                        </InlineStack>
                      </BlockStack>

                      {test.needsRecovery && (
                        <Form method="post">
                          <input type="hidden" name="testId" value={test.id} />
                          <Button
                            submit
                            loading={isLoading}
                            disabled={isLoading}
                          >
                            Recover
                          </Button>
                        </Form>
                      )}
                    </InlineStack>
                  </Card>
                ))}
              </BlockStack>

              {tests.length === 0 && (
                <Banner>
                  <Text as="p">No active tests found.</Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}