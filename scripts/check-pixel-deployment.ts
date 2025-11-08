import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking A/B Test tracking deployment status...\n');

  // Get the test details
  const test = await prisma.aBTest.findFirst({
    where: { status: 'ACTIVE' }
  });

  if (!test) {
    console.log('No active tests found');
    return;
  }

  console.log('Active Test:');
  console.log('  Name: ' + test.name);
  console.log('  ID: ' + test.id);
  console.log('  Product: ' + test.productId);
  console.log('  Shop: ' + test.shop);
  console.log('  Current Case: ' + test.currentCase);
  console.log('  Status: ' + test.status);

  // Check audit logs for tracking-related events
  const auditLogs = await prisma.auditLog.findMany({
    where: { testId: test.id },
    orderBy: { timestamp: 'desc' },
    take: 10
  });

  console.log('\nRecent Audit Logs (' + auditLogs.length + '):');
  auditLogs.forEach((log, index) => {
    console.log('\n' + (index + 1) + '. ' + log.eventType);
    console.log('   Description: ' + log.description);
    console.log('   User: ' + (log.userId || 'SYSTEM'));
    console.log('   Time: ' + log.timestamp);
  });

  // Check for rotation events
  const rotationEvents = await prisma.rotationEvent.findMany({
    where: { testId: test.id },
    orderBy: { timestamp: 'desc' },
    take: 5
  });

  console.log('\nRecent Rotations (' + rotationEvents.length + '):');
  rotationEvents.forEach((evt, index) => {
    console.log('\n' + (index + 1) + '. ' + evt.fromCase + ' -> ' + evt.toCase);
    console.log('   Success: ' + evt.success);
    console.log('   Triggered by: ' + evt.triggeredBy);
    console.log('   Duration: ' + evt.duration + 'ms');
    console.log('   Time: ' + evt.timestamp);
  });

  console.log('\n=== DIAGNOSIS ===');
  console.log('\nTo check if the pixel is working:');
  console.log('1. Visit your store: https://' + test.shop);
  console.log('2. View the product: ' + test.productId);
  console.log('3. Open browser console and check for "[A/B Test Pixel]" logs');
  console.log('4. The pixel should:');
  console.log('   - Fetch test state from /api/rotation-state');
  console.log('   - Track IMPRESSION to /track');
  console.log('\nKnown issues:');
  console.log('- Pixel extension may not be deployed');
  console.log('- Pixel settings (app_url) may not be configured');
  console.log('- Pixel debug mode may need to be enabled');
  console.log('\nTo enable debug mode:');
  console.log('1. Go to Shopify Admin > Settings > Customer events');
  console.log('2. Find "ab-test-pixel" extension');
  console.log('3. Enable debug mode and set app_url');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
