#!/usr/bin/env bun

/**
 * Comprehensive pixel diagnostic script
 * Checks pixel connection, settings, and tracking status
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  console.log('🔍 Pixel Diagnostic Tool\n');
  console.log('='.repeat(60));

  // 1. Check database for events
  console.log('\n1️⃣ Checking Database Events...');
  const recentEvents = await db.aBTestEvent.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      test: {
        select: {
          id: true,
          name: true,
          productId: true,
          status: true,
        },
      },
    },
  });

  if (recentEvents.length === 0) {
    console.log('❌ No events found in database');
  } else {
    console.log(`✅ Found ${recentEvents.length} recent events:`);
    recentEvents.forEach((event) => {
      console.log(`   - ${event.eventType} | Test: ${event.test.name} | ${event.createdAt.toISOString()}`);
    });
  }

  // 2. Check active tests
  console.log('\n2️⃣ Checking Active Tests...');
  const activeTests = await db.aBTest.findMany({
    where: {
      status: {
        in: ['ACTIVE', 'PAUSED'],
      },
    },
    select: {
      id: true,
      name: true,
      productId: true,
      status: true,
      shop: true,
      currentCase: true,
      events: {
        select: {
          eventType: true,
          createdAt: true,
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (activeTests.length === 0) {
    console.log('❌ No active tests found');
    console.log('   → Create an active test first');
  } else {
    console.log(`✅ Found ${activeTests.length} active test(s):`);
    activeTests.forEach((test) => {
      const eventCounts = {
        IMPRESSION: test.events.filter((e) => e.eventType === 'IMPRESSION').length,
        ADD_TO_CART: test.events.filter((e) => e.eventType === 'ADD_TO_CART').length,
        PURCHASE: test.events.filter((e) => e.eventType === 'PURCHASE').length,
      };
      const lastEvent = test.events[0];
      const lastEventTime = lastEvent ? new Date(lastEvent.createdAt).toISOString() : 'Never';

      console.log(`\n   Test: ${test.name}`);
      console.log(`   - Product: ${test.productId}`);
      console.log(`   - Status: ${test.status}`);
      console.log(`   - Current Case: ${test.currentCase}`);
      console.log(`   - Shop: ${test.shop}`);
      console.log(`   - Events: ${JSON.stringify(eventCounts)}`);
      console.log(`   - Last Event: ${lastEventTime}`);
    });
  }

  // 3. Check event statistics
  console.log('\n3️⃣ Event Statistics...');
  const stats = await db.aBTestEvent.groupBy({
    by: ['eventType'],
    _count: {
      id: true,
    },
  });

  if (stats.length === 0) {
    console.log('❌ No events recorded');
  } else {
    console.log('✅ Event counts:');
    stats.forEach((stat) => {
      console.log(`   - ${stat.eventType}: ${stat._count.id}`);
    });
  }

  // 4. Recommendations
  console.log('\n4️⃣ Recommendations...');

  if (recentEvents.length === 0) {
    console.log('\n⚠️  NO EVENTS DETECTED - Pixel likely not connected or not tracking');
    console.log('\n   Steps to fix:');
    console.log('   1. Visit: /app/connect-pixel');
    console.log('   2. Click "Connect Pixel" button');
    console.log('   3. Enable debug mode in pixel settings');
    console.log('   4. Visit a product page with DevTools open (F12)');
    console.log('   5. Look for [A/B Test Pixel] console logs');
    console.log('   6. Check Network tab for requests to /api/rotation-state and /track');
  } else {
    const hoursSinceLastEvent = recentEvents[0]
      ? (Date.now() - new Date(recentEvents[0].createdAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (hoursSinceLastEvent > 24) {
      console.log(`\n⚠️  Last event was ${hoursSinceLastEvent.toFixed(1)} hours ago`);
      console.log('   → Pixel may have disconnected or stopped tracking');
    } else {
      console.log(`\n✅ Events are being tracked (last event ${hoursSinceLastEvent.toFixed(1)} hours ago)`);
    }
  }

  if (activeTests.length > 0 && recentEvents.length === 0) {
    console.log('\n⚠️  ACTIVE TESTS BUT NO EVENTS');
    console.log('   → Pixel is likely not connected or not firing');
    console.log('   → Check:');
    console.log('     1. Pixel connection status in Shopify Admin');
    console.log('     2. Customer privacy settings (cookie banner)');
    console.log('     3. Browser console for errors');
    console.log('     4. Network requests to API endpoints');
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Next Steps:');
  console.log('   1. Check pixel connection: /app/connect-pixel');
  console.log('   2. Test on storefront: Visit product page with DevTools');
  console.log('   3. Monitor events: bun run scripts/monitor-events.ts');
  console.log('   4. Check Shopify Admin: Settings → Customer Events\n');

  await db.$disconnect();
}

main().catch(console.error);
