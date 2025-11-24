#!/usr/bin/env bun
/**
 * Simple test to check cron rotation status
 */

import db from '../app/db.server';

async function testCron() {
  console.log('🔄 Cron Rotation Test\n');
  console.log('=' .repeat(50));

  const now = new Date();

  // 1. Get tests due for rotation (what cron would process)
  const testsDue = await db.aBTest.findMany({
    where: {
      status: 'ACTIVE',
      nextRotation: {
        lte: now,
      },
    },
  });

  console.log(`\n📊 Tests Due for Rotation: ${testsDue.length}`);
  if (testsDue.length > 0) {
    for (const test of testsDue) {
      console.log(`  - ${test.name} (${test.id})`);
    }
  }

  // 2. Get all active tests and their schedules
  const activeTests = await db.aBTest.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { nextRotation: 'asc' },
  });

  console.log(`\n📋 All Active Tests: ${activeTests.length}`);
  for (const test of activeTests) {
    const minutesUntil = test.nextRotation
      ? Math.round((test.nextRotation.getTime() - now.getTime()) / (1000 * 60))
      : null;

    console.log(`\n  Test: ${test.name}`);
    console.log(`    Shop: ${test.shop}`);
    console.log(`    Current: ${test.currentCase}`);
    console.log(`    Next rotation: ${test.nextRotation?.toISOString() || 'Not scheduled'}`);

    if (minutesUntil !== null) {
      if (minutesUntil <= 0) {
        console.log(`    ⚠️  OVERDUE by ${Math.abs(minutesUntil)} minutes!`);
      } else if (minutesUntil < 60) {
        console.log(`    ⏱️  Rotating in ${minutesUntil} minutes`);
      } else {
        const hours = Math.round(minutesUntil / 60);
        console.log(`    ⏱️  Rotating in ${hours} hours`);
      }
    }
  }

  // 3. Check cron endpoint
  console.log('\n🔗 Cron Endpoint:');
  console.log(`  URL: https://abtest.dreamshot.io/api/rotation`);
  console.log(`  Schedule: Every 10 minutes`);
  console.log(`  Method: GET (Vercel cron) or POST (manual)`);

  // 4. Check for issues
  console.log('\n⚠️  Known Issues:');
  console.log(`  1. Cron needs shop sessions for each test`);
  console.log(`  2. Currently using single-shop authentication`);
  console.log(`  3. Manual trigger requires ROTATION_CRON_TOKEN`);

  await db.$disconnect();
}

testCron();
