#!/usr/bin/env bun
/**
 * Monitor ABTestEvent table for new events in real-time
 * Run this after deploying the pixel to see events as they come in
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function monitorEvents() {
  console.log('🔍 Monitoring ABTestEvents... (Press Ctrl+C to stop)\n');

  let lastCount = 0;
  let lastEventId: string | null = null;

  // Initial count
  const initialCount = await prisma.aBTestEvent.count();
  console.log(`📊 Current events in database: ${initialCount}`);
  lastCount = initialCount;

  if (initialCount > 0) {
    const latestEvent = await prisma.aBTestEvent.findFirst({
      orderBy: { createdAt: 'desc' }
    });
    lastEventId = latestEvent?.id || null;
    console.log(`   Latest event: ${latestEvent?.eventType} at ${latestEvent?.createdAt}`);
  }

  console.log('\n⏳ Waiting for new events...\n');

  // Poll every 2 seconds
  setInterval(async () => {
    try {
      const currentCount = await prisma.aBTestEvent.count();

      if (currentCount > lastCount) {
        console.log(`\n🎉 NEW EVENTS DETECTED! (${currentCount - lastCount} new)`);

        // Fetch new events
        const newEvents = await prisma.aBTestEvent.findMany({
          orderBy: { createdAt: 'desc' },
          take: currentCount - lastCount,
        });

        for (const event of newEvents.reverse()) {
          console.log('━'.repeat(60));
          console.log(`📍 Event Type: ${event.eventType}`);
          console.log(`   Test ID: ${event.testId}`);
          console.log(`   Session: ${event.sessionId}`);
          console.log(`   Active Case: ${event.activeCase}`);
          console.log(`   Product: ${event.productId}`);
          if (event.variantId) console.log(`   Variant: ${event.variantId}`);
          console.log(`   Time: ${event.createdAt.toISOString()}`);
          if (event.revenue) console.log(`   💰 Revenue: $${event.revenue}`);
          console.log('━'.repeat(60));
        }

        lastCount = currentCount;
        lastEventId = newEvents[0]?.id || lastEventId;
      }

      // Show heartbeat every 10 checks (20 seconds)
      if (Math.random() < 0.1) {
        process.stdout.write('.');
      }

    } catch (error) {
      console.error('Error checking events:', error);
    }
  }, 2000);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Stopping monitor...');
  await prisma.$disconnect();
  process.exit(0);
});

// Run monitor
monitorEvents().catch(async (error) => {
  console.error('Fatal error:', error);
  await prisma.$disconnect();
  process.exit(1);
});