import {
  Card,
  Text,
  BlockStack,
  Grid,
  Box,
} from "@shopify/polaris";

interface ABTestSummaryProps {
  totalTests: number;
  runningTests: number;
  totalImpressions: number;
  avgLift: string;
}

export function ABTestSummary({ 
  totalTests, 
  runningTests, 
  totalImpressions, 
  avgLift 
}: ABTestSummaryProps) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">Testing Overview</Text>
          
          <Grid columns={{ xs: 2, md: 4 }}>
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Total Tests</Text>
              <Text variant="headingLg">{totalTests}</Text>
            </BlockStack>
            
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Active Tests</Text>
              <Text variant="headingLg" tone={runningTests > 0 ? "success" : undefined}>
                {runningTests}
              </Text>
            </BlockStack>
            
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Total Impressions</Text>
              <Text variant="headingLg">{totalImpressions.toLocaleString()}</Text>
            </BlockStack>
            
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Avg. Lift</Text>
              <Text 
                variant="headingLg" 
                tone={parseFloat(avgLift) > 0 ? "success" : "critical"}
              >
                {avgLift}%
              </Text>
            </BlockStack>
          </Grid>
        </BlockStack>
      </Box>
    </Card>
  );
}