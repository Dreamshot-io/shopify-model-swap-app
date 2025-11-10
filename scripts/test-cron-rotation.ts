#!/usr/bin/env bun
/**
 * Test script to simulate what the cron job does
 * Tests rotation for all active tests across all shops
 */

import db from '../app/db.server';

async function testCronRotation() {
  console.log('🔄 Testing Cron Rotation System\n');
  console.log('=' .repeat(50));

  try {
    // 1. Check what tests would be rotated
    const now = new Date();
    const testsDueForRotation = await db.aBTest.findMany({
      where: {
        status: 'ACTIVE',
        nextRotation: {
          lte: now,
        },
      },
      include: {
        variants: true,
      },
    });

    console.log(`\n📊 Tests Due for Rotation: ${testsDueForRotation.length}`);

    if (testsDueForRotation.length === 0) {
      console.log('\nNo tests are due for rotation right now.');

      // Show all active tests and when they're due
      const allActiveTests = await db.aBTest.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          shop: true,
          productId: true,
          currentCase: true,
          nextRotation: true,
          rotationHours: true,
        },
        orderBy: { nextRotation: 'asc' },
      });

      if (allActiveTests.length > 0) {
        console.log('\n📋 All Active Tests:');
        console.log('─'.repeat(50));

        for (const test of allActiveTests) {
          const timeUntilRotation = test.nextRotation
            ? Math.round((test.nextRotation.getTime() - now.getTime()) / (1000 * 60))
            : null;

          console.log(`\nTest: ${test.name}`);
          console.log(`  ID: ${test.id}`);
          console.log(`  Shop: ${test.shop}`);
          console.log(`  Product: ${test.productId}`);
          console.log(`  Current Case: ${test.currentCase}`);
          const rotationDisplay = test.rotationHours < 1
            ? `${Math.round(test.rotationHours * 60)}m`
            : `${test.rotationHours}h`;
          console.log(`  Rotation Interval: ${rotationDisplay}`);
          console.log(`  Next Rotation: ${test.nextRotation?.toISOString() || 'Not scheduled'}`);

          if (timeUntilRotation !== null) {
            if (timeUntilRotation > 0) {
              console.log(`  ⏱️  Rotating in: ${timeUntilRotation} minutes`);
            } else {
              console.log(`  ⚠️  OVERDUE by: ${Math.abs(timeUntilRotation)} minutes`);
            }
          }
        }
      } else {
        console.log('\n❌ No active tests found in database.');
      }
    } else {
      console.log('\n🔄 Tests that would be rotated:');
      console.log('─'.repeat(50));

      for (const test of testsDueForRotation) {
        console.log(`\nTest: ${test.name}`);
        console.log(`  ID: ${test.id}`);
        console.log(`  Shop: ${test.shop}`);
        console.log(`  Product: ${test.productId}`);
        console.log(`  Current Case: ${test.currentCase}`);
        console.log(`  Will rotate to: ${test.currentCase === 'BASE' ? 'TEST' : 'BASE'}`);
        console.log(`  Next Rotation: ${test.nextRotation?.toISOString()}`);
        const rotationDisplay = test.rotationHours < 1
          ? `${Math.round(test.rotationHours * 60)}m`
          : `${test.rotationHours}h`;
        console.log(`  Rotation Interval: ${rotationDisplay}`);

        // Check if test has required images
        const baseImages = test.baseImages as any[] || [];
        const testImages = test.testImages as any[] || [];

        console.log(`  Base Images: ${baseImages.length}`);
        console.log(`  Test Images: ${testImages.length}`);

        if (baseImages.length === 0 || testImages.length === 0) {
          console.log(`  ⚠️  WARNING: Missing images for rotation!`);
        }
      }
    }

    // 2. Check cron job configuration
    console.log('\n⚙️  Cron Job Configuration:');
    console.log('─'.repeat(50));
    console.log('Schedule: */10 * * * * (every 10 minutes)');
    console.log('Endpoint: /api/rotation');
    console.log('Deployed on: Vercel');

    // 3. Test the rotation endpoint
    console.log('\n🔗 Testing Rotation Endpoint:');
    console.log('─'.repeat(50));

    const appUrl = process.env.SHOPIFY_APP_URL || 'https://shopify-txl.dreamshot.io';
    const testUrl = `${appUrl}/api/rotation`;

    console.log(`URL: ${testUrl}`);

    // Check if we have a token for manual testing
    const token = process.env.ROTATION_CRON_TOKEN;
    if (token) {
      console.log('✅ ROTATION_CRON_TOKEN is set');

      // Simulate a manual call
      console.log('\nSimulating manual rotation call...');
      try {
        const response = await fetch(testUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const result = await response.json();
          console.log('✅ Manual rotation successful:', result);
        } else {
          console.log('❌ Manual rotation failed:', response.status, response.statusText);
          const error = await response.text();
          console.log('Error:', error);
        }
      } catch (error) {
        console.log('❌ Failed to call rotation endpoint:', error);
      }
    } else {
      console.log('⚠️  ROTATION_CRON_TOKEN not set - manual testing not possible');
    }

    // 4. Check rotation logs
    console.log('\n📜 Recent Rotation History:');
    console.log('─'.repeat(50));

    const recentRotations = await db.aBTestRotation.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' },
      select: {
        testId: true,
        timestamp: true,
        fromCase: true,
        toCase: true,
        triggeredBy: true,
        success: true,
        error: true,
      },
    });

    if (recentRotations.length > 0) {
      for (const rotation of recentRotations) {
        const status = rotation.success ? '✅' : '❌';
        console.log(`\n${status} ${rotation.timestamp.toISOString()}`);
        console.log(`  Test: ${rotation.testId}`);
        console.log(`  Rotation: ${rotation.fromCase} → ${rotation.toCase}`);
        console.log(`  Triggered by: ${rotation.triggeredBy}`);
        if (rotation.error) {
          console.log(`  Error: ${rotation.error}`);
        }
      }
    } else {
      console.log('No rotation history found.');
    }

    // 5. Identify potential issues
    console.log('\n⚠️  Potential Issues:');
    console.log('─'.repeat(50));

    const issues = [];

    // Check for authentication issues
    issues.push({
      issue: 'Authentication in Cron',
      status: '❌',
      description: 'The cron job tries to use authenticate.admin() but has no shop session.',
      solution: 'Need to refactor to handle multi-shop rotation without session.',
    });

    // Check for missing environment variables
    if (!process.env.ROTATION_CRON_TOKEN) {
      issues.push({
        issue: 'Missing ROTATION_CRON_TOKEN',
        status: '⚠️',
        description: 'Token not set for manual rotation testing.',
        solution: 'Set ROTATION_CRON_TOKEN in .env file.',
      });
    }

    // Check for tests without nextRotation
    const testsWithoutSchedule = await db.aBTest.count({
      where: {
        status: 'ACTIVE',
        nextRotation: null,
      },
    });

    if (testsWithoutSchedule > 0) {
      issues.push({
        issue: 'Tests without schedule',
        status: '⚠️',
        description: `${testsWithoutSchedule} active tests have no nextRotation set.`,
        solution: 'Set nextRotation when activating tests.',
      });
    }

    if (issues.length > 0) {
      for (const issue of issues) {
        console.log(`\n${issue.status} ${issue.issue}`);
        console.log(`  Problem: ${issue.description}`);
        console.log(`  Solution: ${issue.solution}`);
      }
    } else {
      console.log('No issues detected.');
    }

    // 6. Summary
    console.log('\n📈 Summary:');
    console.log('=' .repeat(50));
    const totalTests = await db.aBTest.count();
    const activeTests = await db.aBTest.count({ where: { status: 'ACTIVE' } });
    const overdueTests = await db.aBTest.count({
      where: {
        status: 'ACTIVE',
        nextRotation: { lt: now },
      },
    });

    console.log(`Total Tests: ${totalTests}`);
    console.log(`Active Tests: ${activeTests}`);
    console.log(`Tests Due for Rotation: ${testsDueForRotation.length}`);
    console.log(`Overdue Tests: ${overdueTests}`);

    if (overdueTests > 0) {
      console.log('\n⚠️  Action Required: Run manual rotation for overdue tests!');
    }

  } catch (error) {
    console.error('\n❌ Error testing cron rotation:', error);
  } finally {
    await db.$disconnect();
  }
}

// Run the test
testCronRotation();
