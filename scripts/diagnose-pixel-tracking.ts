import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Pixel Tracking Diagnosis\n');

  // Get all active/paused tests
  const tests = await prisma.aBTest.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAUSED'] }
    },
    select: {
      id: true,
      name: true,
      productId: true,
      status: true,
      currentCase: true,
    },
    orderBy: { updatedAt: 'desc' }
  });

  console.log(`Found ${tests.length} active/paused test(s):\n`);

  if (tests.length === 0) {
    console.log('❌ No active tests found!');
    console.log('\n💡 Solution: Create an ACTIVE test for your product');
    return;
  }

  tests.forEach((test, index) => {
    console.log(`${index + 1}. Test: ${test.name}`);
    console.log(`   ID: ${test.id}`);
    console.log(`   Status: ${test.status}`);
    console.log(`   Current Case: ${test.currentCase}`);
    console.log(`   ProductId: ${test.productId}`);
    console.log(`   ProductId Format: ${test.productId.startsWith('gid://') ? 'GID ✅' : 'Numeric ⚠️'}`);
    console.log('');
  });

  // Check events
  const eventCount = await prisma.aBTestEvent.count();
  console.log(`\n📊 Database Events: ${eventCount}`);

  if (eventCount > 0) {
    const recentEvents = await prisma.aBTestEvent.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventType: true,
        productId: true,
        testId: true,
        activeCase: true,
        createdAt: true,
      }
    });

    console.log('\nRecent events:');
    recentEvents.forEach((event, i) => {
      console.log(`  ${i + 1}. ${event.eventType} - Product: ${event.productId} - Case: ${event.activeCase} - ${event.createdAt.toISOString()}`);
    });
  } else {
    console.log('\n❌ No events found in database');
  }

  // Check for productId mismatch
  console.log('\n🔍 ProductId Format Check:');
  console.log('Pixel sends: gid://shopify/Product/7821131415621 (after normalization)');
  console.log('Test should have: gid://shopify/Product/7821131415621');

  const numericProductId = '7821131415621';
  const gidProductId = `gid://shopify/Product/${numericProductId}`;

  const testWithNumeric = await prisma.aBTest.findFirst({
    where: { productId: numericProductId }
  });

  const testWithGid = await prisma.aBTest.findFirst({
    where: { productId: gidProductId }
  });

  console.log(`\nTest with numeric ID "${numericProductId}": ${testWithNumeric ? '✅ Found' : '❌ Not found'}`);
  console.log(`Test with GID "${gidProductId}": ${testWithGid ? '✅ Found' : '❌ Not found'}`);

  if (!testWithGid && !testWithNumeric) {
    console.log('\n⚠️  No test found for product 7821131415621');
    console.log('💡 Check if you have a test for this product');
  } else if (testWithNumeric && !testWithGid) {
    console.log('\n⚠️  MISMATCH: Test has numeric ID but pixel sends GID format');
    console.log('💡 Solution: Update test.productId to GID format or normalize in API');
  }

  console.log('\n✅ Diagnosis complete');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
