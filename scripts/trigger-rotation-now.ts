#!/usr/bin/env bun
/**
 * Manually trigger rotation for a test
 * Useful for testing without waiting for cron
 */

import db from '../app/db.server';

async function triggerRotation(testIdArg?: string) {
  console.log('🚀 Manual Rotation Trigger\n');
  console.log('=' .repeat(50));

  try {
    // Get test to rotate
    let test;

    if (testIdArg) {
      // Use provided test ID
      test = await db.aBTest.findUnique({
        where: { id: testIdArg },
      });

      if (!test) {
        console.error(`❌ Test ${testIdArg} not found`);
        process.exit(1);
      }
    } else {
      // Get the first active test
      const tests = await db.aBTest.findMany({
        where: { status: 'ACTIVE' },
        take: 1,
      });

      if (tests.length === 0) {
        console.error('❌ No active tests found');
        process.exit(1);
      }

      test = tests[0];
    }

    console.log(`\n📦 Test to Rotate:`);
    console.log(`  Name: ${test.name}`);
    console.log(`  ID: ${test.id}`);
    console.log(`  Shop: ${test.shop}`);
    console.log(`  Current Case: ${test.currentCase}`);
    console.log(`  Next scheduled: ${test.nextRotation?.toISOString() || 'Not scheduled'}`);

    // Update nextRotation to NOW to trigger it
    const now = new Date();
    await db.aBTest.update({
      where: { id: test.id },
      data: {
        nextRotation: now,
      },
    });

    console.log(`\n✅ Updated nextRotation to: ${now.toISOString()}`);
    console.log('   Test is now due for rotation!');

    // Try to call the rotation endpoint
    const appUrl = process.env.SHOPIFY_APP_URL || 'https://shopify.dreamshot.io';
    const rotationUrl = `${appUrl}/api/rotation`;
    console.log(`\n📡 Calling Rotation Endpoint...`);
    console.log(`   URL: ${rotationUrl}`);
    console.log(`   Note: Auth check temporarily disabled for testing`);

    try {
      const response = await fetch(rotationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        console.log('\n✅ Rotation triggered successfully!');
        console.log('   Result:', JSON.stringify(result, null, 2));
      } else {
        console.log(`\n⚠️  Rotation endpoint returned: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log('   Response:', text);
      }
    } catch (error) {
      console.log('\n❌ Failed to call rotation endpoint:', error);
    }

    // Check the test status after rotation attempt
    const updatedTest = await db.aBTest.findUnique({
      where: { id: test.id },
    });

    console.log(`\n📊 Test Status After Trigger:`);
    console.log(`  Current Case: ${updatedTest?.currentCase}`);
    console.log(`  Next Rotation: ${updatedTest?.nextRotation?.toISOString()}`);
    console.log(`  Last Rotation: ${updatedTest?.lastRotation?.toISOString()}`);

    if (updatedTest?.currentCase !== test.currentCase) {
      console.log('\n🎉 Rotation was successful!');
    } else {
      console.log('\n⏳ Rotation pending - will be picked up by next cron run');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await db.$disconnect();
  }
}

// Get test ID from command line arguments
const testId = process.argv[2];
if (testId && testId === '--help') {
  console.log('Usage: bun run scripts/trigger-rotation-now.ts [testId]');
  console.log('  If no testId provided, uses the first active test');
  process.exit(0);
}

triggerRotation(testId);
