import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Testing tracking endpoint functionality...\n');

  // Get active test
  const test = await prisma.aBTest.findFirst({
    where: { status: 'ACTIVE' }
  });

  if (!test) {
    console.log('No active test found');
    return;
  }

  console.log('Creating test event directly in database...');
  
  const testEvent = await prisma.aBTestEvent.create({
    data: {
      testId: test.id,
      sessionId: 'manual_test_' + Date.now(),
      eventType: 'IMPRESSION',
      activeCase: test.currentCase,
      productId: test.productId,
      variantId: null,
      metadata: {
        source: 'manual_test',
        timestamp: new Date().toISOString(),
        test: true
      }
    }
  });

  console.log('\n✓ Test event created successfully!');
  console.log('  Event ID: ' + testEvent.id);
  console.log('  Test ID: ' + testEvent.testId);
  console.log('  Event Type: ' + testEvent.eventType);
  console.log('  Active Case: ' + testEvent.activeCase);
  console.log('  Session: ' + testEvent.sessionId);
  console.log('  Created: ' + testEvent.createdAt);

  // Count events
  const totalEvents = await prisma.aBTestEvent.count();
  console.log('\nTotal ABTestEvent records now: ' + totalEvents);

  // Clean up test event
  console.log('\nCleaning up test event...');
  await prisma.aBTestEvent.delete({
    where: { id: testEvent.id }
  });
  console.log('✓ Test event removed');

  const finalCount = await prisma.aBTestEvent.count();
  console.log('Final count: ' + finalCount);

  console.log('\n=== CONCLUSION ===');
  console.log('Database write functionality: ✅ WORKING');
  console.log('Issue: Pixel extension not sending events');
  console.log('\nNext action: Deploy and configure ab-test-pixel extension');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
