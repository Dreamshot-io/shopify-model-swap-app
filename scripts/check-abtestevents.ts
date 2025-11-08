import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Querying ABTestEvent records...\n');

  // Count all events
  const totalCount = await prisma.aBTestEvent.count();
  console.log('Total ABTestEvent records: ' + totalCount);

  if (totalCount === 0) {
    console.log('\nNo ABTestEvent records found in the database.');
    return;
  }

  // Count by event type
  const impressionCount = await prisma.aBTestEvent.count({
    where: { eventType: 'IMPRESSION' }
  });
  const addToCartCount = await prisma.aBTestEvent.count({
    where: { eventType: 'ADD_TO_CART' }
  });
  const purchaseCount = await prisma.aBTestEvent.count({
    where: { eventType: 'PURCHASE' }
  });

  console.log('\nBreakdown by event type:');
  console.log('  - IMPRESSION: ' + impressionCount);
  console.log('  - ADD_TO_CART: ' + addToCartCount);
  console.log('  - PURCHASE: ' + purchaseCount);

  // Get recent events
  const recentEvents = await prisma.aBTestEvent.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      test: {
        select: {
          id: true,
          name: true,
          productId: true
        }
      }
    }
  });

  console.log('\nMost recent events (up to 10):');
  recentEvents.forEach((event, index) => {
    console.log('\n' + (index + 1) + '. Event ID: ' + event.id);
    console.log('   Test: ' + event.test.name + ' (' + event.test.id + ')');
    console.log('   Event Type: ' + event.eventType);
    console.log('   Active Case: ' + event.activeCase);
    console.log('   Session: ' + event.sessionId);
    console.log('   Product ID: ' + event.productId);
    console.log('   Variant ID: ' + (event.variantId || 'N/A'));
    console.log('   Created: ' + event.createdAt);
  });

  // Group by test
  const eventsByTest = await prisma.aBTestEvent.groupBy({
    by: ['testId', 'eventType'],
    _count: {
      id: true
    }
  });

  if (eventsByTest.length > 0) {
    console.log('\nEvents grouped by test and type:');
    for (const group of eventsByTest) {
      const test = await prisma.aBTest.findUnique({
        where: { id: group.testId },
        select: { name: true }
      });
      console.log('  - Test: ' + (test?.name || group.testId));
      console.log('    Type: ' + group.eventType + ', Count: ' + group._count.id);
    }
  }

  // Check for active tests
  const activeTests = await prisma.aBTest.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      productId: true,
      currentCase: true,
      _count: {
        select: {
          events: true
        }
      }
    }
  });

  console.log('\nActive tests (' + activeTests.length + '):');
  activeTests.forEach(test => {
    console.log('  - ' + test.name + ' (' + test.id + ')');
    console.log('    Product: ' + test.productId);
    console.log('    Current Case: ' + test.currentCase);
    console.log('    Event Count: ' + test._count.events);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
