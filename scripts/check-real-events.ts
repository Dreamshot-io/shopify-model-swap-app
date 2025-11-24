#!/usr/bin/env bun
/**
 * Check for REAL events from the storefront pixel (not manual tests)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkRealEvents() {
  console.log('🔍 Checking for REAL storefront events (vs manual tests)\n');
  console.log('='.repeat(60));

  // Get all events
  const allEvents = await prisma.aBTestEvent.findMany({
    select: {
      sessionId: true,
      eventType: true,
      createdAt: true,
      metadata: true
    },
    orderBy: { createdAt: 'desc' }
  });

  // Separate real vs test events
  const testEvents = allEvents.filter(e =>
    e.sessionId.startsWith('test') ||
    e.sessionId.includes('test_') ||
    (e.metadata && typeof e.metadata === 'object' &&
     ('source' in e.metadata && (e.metadata.source === 'manual_test' ||
      e.metadata.source === 'diagnostic_test')))
  );

  const realEvents = allEvents.filter(e =>
    !e.sessionId.startsWith('test') &&
    !e.sessionId.includes('test_') &&
    !(e.metadata && typeof e.metadata === 'object' &&
      ('source' in e.metadata && (e.metadata.source === 'manual_test' ||
       e.metadata.source === 'diagnostic_test')))
  );

  console.log('\n📊 EVENT SOURCES:');
  console.log(`   Manual Test Events: ${testEvents.length}`);
  console.log(`   Real Storefront Events: ${realEvents.length}`);
  console.log();

  if (realEvents.length === 0) {
    console.log('❌ NO REAL STOREFRONT EVENTS FOUND!');
    console.log();
    console.log('The pixel is NOT working on the actual storefront.');
    console.log();
    console.log('🔧 TO FIX THIS:');
    console.log('1. Go to: https://admin.shopify.com/store/genlabs-dev-store/settings/customer_events');
    console.log('2. Look for "ab-test-pixel" in the list');
    console.log('3. If not there: The pixel wasn\'t deployed properly');
    console.log('4. If there but "Disconnected": Click to connect it');
    console.log('5. Configure with:');
    console.log('   - App URL: https://abtest.dreamshot.io');
    console.log('   - Enable A/B Testing: true');
    console.log('   - Debug Mode: true');
    console.log();
    console.log('6. Visit a product page with DevTools open');
    console.log('7. Look for [A/B Test Pixel] logs in console');
  } else {
    console.log('✅ REAL STOREFRONT EVENTS FOUND!');
    console.log();

    // Show unique real sessions
    const realSessions = [...new Set(realEvents.map(e => e.sessionId))];
    console.log(`Unique real sessions: ${realSessions.length}`);

    for (const session of realSessions.slice(0, 5)) {
      const sessionEvents = realEvents.filter(e => e.sessionId === session);
      console.log(`\n   Session: ${session}`);
      for (const event of sessionEvents) {
        console.log(`     - ${event.eventType} at ${event.createdAt.toLocaleTimeString()}`);
      }
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('\n📝 All Sessions Found:');

  const allSessions = [...new Set(allEvents.map(e => e.sessionId))];
  for (const session of allSessions) {
    const type = session.includes('test') ? '🧪 TEST' : '✅ REAL';
    const count = allEvents.filter(e => e.sessionId === session).length;
    console.log(`   ${type} ${session.substring(0, 30)}... (${count} events)`);
  }
}

// Run check
checkRealEvents()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
