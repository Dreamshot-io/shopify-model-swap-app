import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Querying ABTest records...\n');

  // Count all tests
  const totalTests = await prisma.aBTest.count();
  console.log('Total ABTest records: ' + totalTests);

  if (totalTests === 0) {
    console.log('\nNo ABTest records found in the database.');
    return;
  }

  // Get all tests with details
  const tests = await prisma.aBTest.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      variants: true,
      _count: {
        select: {
          events: true,
          rotationEvents: true,
          auditLogs: true
        }
      }
    }
  });

  console.log('\nAll A/B Tests:');
  tests.forEach((test, index) => {
    console.log('\n' + (index + 1) + '. ' + test.name);
    console.log('   ID: ' + test.id);
    console.log('   Shop: ' + test.shop);
    console.log('   Product ID: ' + test.productId);
    console.log('   Status: ' + test.status);
    console.log('   Current Case: ' + test.currentCase);
    console.log('   Traffic Split: ' + test.trafficSplit + '%');
    const rotationDisplay = test.rotationHours < 1
      ? `${Math.round(test.rotationHours * 60)} minutes`
      : `${test.rotationHours} hour${test.rotationHours !== 1 ? 's' : ''}`;
    console.log('   Rotation Interval: ' + rotationDisplay);
    console.log('   Last Rotation: ' + (test.lastRotation || 'Never'));
    console.log('   Next Rotation: ' + (test.nextRotation || 'Not scheduled'));
    console.log('   Variants: ' + test.variants.length);
    console.log('   Events: ' + test._count.events);
    console.log('   Rotation Events: ' + test._count.rotationEvents);
    console.log('   Audit Logs: ' + test._count.auditLogs);
    console.log('   Created: ' + test.createdAt);
  });

  // Count by status
  const statusCounts = await prisma.aBTest.groupBy({
    by: ['status'],
    _count: {
      id: true
    }
  });

  console.log('\nTests by status:');
  statusCounts.forEach(stat => {
    console.log('  - ' + stat.status + ': ' + stat._count.id);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
