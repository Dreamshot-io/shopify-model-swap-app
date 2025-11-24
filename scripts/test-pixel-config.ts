#!/usr/bin/env bun
/**
 * Test pixel configuration and simulate different tracking scenarios
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testPixelConfig() {
  console.log('🔍 Testing A/B Test Pixel Configuration\n');
  console.log('='.repeat(60));

  // 1. Check if we have any active tests
  const activeTest = await prisma.aBTest.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      events: {
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });

  if (!activeTest) {
    console.log('❌ No active A/B tests found');
    console.log('   Create an A/B test first!');
    return;
  }

  console.log('✅ Active Test Found');
  console.log(`   Name: ${activeTest.name}`);
  console.log(`   ID: ${activeTest.id}`);
  console.log(`   Product: ${activeTest.productId}`);
  console.log(`   Current Case: ${activeTest.currentCase}`);
  console.log();

  // 2. Check event statistics
  const stats = await prisma.aBTestEvent.groupBy({
    by: ['eventType', 'activeCase'],
    where: { testId: activeTest.id },
    _count: true,
    orderBy: [
      { eventType: 'asc' },
      { activeCase: 'asc' }
    ]
  });

  console.log('📊 Event Statistics:');
  if (stats.length === 0) {
    console.log('   No events tracked yet');
  } else {
    for (const stat of stats) {
      console.log(`   ${stat.eventType} (${stat.activeCase}): ${stat._count} events`);
    }
  }
  console.log();

  // 3. Check unique sessions
  const uniqueSessions = await prisma.aBTestEvent.findMany({
    where: { testId: activeTest.id },
    distinct: ['sessionId'],
    select: { sessionId: true, eventType: true, activeCase: true }
  });

  console.log('🔑 Unique Sessions:', uniqueSessions.length);
  console.log();

  // 4. Recent events
  console.log('📅 Recent Events (last 5):');
  const recentEvents = activeTest.events.slice(0, 5);

  if (recentEvents.length === 0) {
    console.log('   No events yet');
  } else {
    for (const event of recentEvents) {
      const time = new Date(event.createdAt).toLocaleTimeString();
      console.log(`   ${time} - ${event.eventType} (${event.activeCase}) - Session: ${event.sessionId.slice(0, 20)}...`);
    }
  }
  console.log();

  // 5. Configuration instructions
  console.log('🔧 PIXEL CONFIGURATION REQUIRED:');
  console.log('='.repeat(60));
  console.log();
  console.log('1. Go to Shopify Admin → Settings → Customer events');
  console.log('2. Find "ab-test-pixel" and click to configure');
  console.log('3. Set these values:');
  console.log();
  console.log('   App URL:           https://abtest.dreamshot.io');
  console.log('   Enable A/B Testing: true');
  console.log('   Debug Mode:        true');
  console.log();
  console.log('4. Click "Connect" or ensure status is "Connected"');
  console.log();

  // 6. Why only 1 impression?
  console.log('❓ WHY ONLY 1 IMPRESSION PER VISIT?');
  console.log('='.repeat(60));
  console.log();
  console.log('The pixel uses SESSION-BASED DEDUPLICATION:');
  console.log('• Each user gets 1 impression per session per case (BASE or TEST)');
  console.log('• Refreshing the page won\'t create duplicate impressions');
  console.log('• This prevents inflating metrics');
  console.log();
  console.log('To get more impressions:');
  console.log('1. Clear browser storage (DevTools → Application → Clear Storage)');
  console.log('2. Use incognito/private window');
  console.log('3. Use different browser');
  console.log('4. Wait for rotation (changes from BASE to TEST)');
  console.log();

  // 7. Test the tracking API directly
  console.log('🧪 TESTING TRACKING API:');
  console.log('='.repeat(60));
  console.log();

  const testSessionId = `test_${Date.now()}`;
  const testPayload = {
    testId: activeTest.id,
    sessionId: testSessionId,
    eventType: 'IMPRESSION',
    activeCase: activeTest.currentCase,
    productId: activeTest.productId,
    metadata: { source: 'diagnostic_test' }
  };

  console.log('Sending test impression...');

  try {
    const response = await fetch('https://abtest.dreamshot.io/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ API is working! Event tracked:', result.eventId);
    } else {
      console.log('❌ API error:', result.error);
    }
  } catch (error) {
    console.log('❌ Network error:', error);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('📝 Next Steps:');
  console.log('1. Configure pixel in Shopify Admin (see above)');
  console.log('2. Open browser DevTools (F12) → Console tab');
  console.log('3. Visit product page');
  console.log('4. Look for [A/B Test Pixel] logs');
  console.log('5. Run monitor script: bun run scripts/monitor-events.ts');
}

// Run test
testPixelConfig()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
