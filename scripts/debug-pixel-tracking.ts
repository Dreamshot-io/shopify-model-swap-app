#!/usr/bin/env bun

/**
 * Debug script to check why pixel events aren't being recorded
 * Checks: active tests, API endpoints, pixel configuration
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  console.log('🔍 Pixel Tracking Debug Tool\n');
  console.log('='.repeat(60));

  // 1. Check active tests
  console.log('\n1️⃣ Checking Active Tests...');
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
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (activeTests.length === 0) {
    console.log('❌ NO ACTIVE TESTS FOUND');
    console.log('   → Create an active test first');
    console.log('   → Tests must be ACTIVE or PAUSED (not DRAFT)');
    return;
  }

  console.log(`✅ Found ${activeTests.length} active test(s):\n`);
  activeTests.forEach((test) => {
    console.log(`   Test: ${test.name}`);
    console.log(`   - ID: ${test.id}`);
    console.log(`   - Product: ${test.productId}`);
    console.log(`   - Status: ${test.status}`);
    console.log(`   - Shop: ${test.shop}`);
    console.log(`   - Current Case: ${test.currentCase}`);
    console.log(`   - Events: ${test.events.length} recent`);
    if (test.events.length > 0) {
      test.events.forEach((e) => {
        console.log(`     • ${e.eventType} at ${e.createdAt.toISOString()}`);
      });
    } else {
      console.log('     • No events recorded yet');
    }
    console.log('');
  });

  // 2. Check API endpoints accessibility
  console.log('2️⃣ Testing API Endpoints...');
  const appUrl = process.env.SHOPIFY_APP_URL || 'https://app-dev.dreamshot.io';
  const testProductId = activeTests[0]?.productId;

  if (testProductId) {
    console.log(`\n   Testing rotation-state API...`);
    console.log(`   URL: ${appUrl}/api/rotation-state?productId=${encodeURIComponent(testProductId)}`);

    try {
      const response = await fetch(
        `${appUrl}/api/rotation-state?productId=${encodeURIComponent(testProductId)}`
      );
      const data = await response.json();

      if (data.testId) {
        console.log(`   ✅ API responds correctly:`);
        console.log(`      - testId: ${data.testId}`);
        console.log(`      - activeCase: ${data.activeCase}`);
      } else {
        console.log(`   ⚠️  API returns no test:`);
        console.log(`      Response: ${JSON.stringify(data)}`);
        console.log(`   → Check if productId matches exactly`);
      }
    } catch (error) {
      console.log(`   ❌ API request failed:`);
      console.log(`      Error: ${error instanceof Error ? error.message : error}`);
      console.log(`   → Check if server is running`);
      console.log(`   → Check CORS settings`);
    }
  }

  // 3. Check pixel configuration
  console.log('\n3️⃣ Pixel Configuration Check...');
  console.log(`   App URL: ${appUrl}`);
  console.log(`   Rotation API: ${appUrl}/api/rotation-state`);
  console.log(`   Track API: ${appUrl}/track`);
  console.log(`\n   ⚠️  Verify in Shopify Admin:`);
  console.log(`   1. Settings → Customer Events`);
  console.log(`   2. Find your pixel`);
  console.log(`   3. Check settings:`);
  console.log(`      - app_url: ${appUrl}`);
  console.log(`      - enabled: true`);
  console.log(`      - debug: true (for development)`);

  // 4. Common issues checklist
  console.log('\n4️⃣ Common Issues Checklist...\n');

  const issues = [];

  if (activeTests.length === 0) {
    issues.push('❌ No active tests');
  }

  if (!testProductId) {
    issues.push('❌ No product ID to test');
  }

  console.log('   Check these in order:');
  console.log('   1. ✅ Pixel connected in Shopify Admin');
  console.log('   2. ✅ Pixel settings have correct app_url');
  console.log('   3. ✅ Debug mode enabled (to see console logs)');
  console.log('   4. ✅ Active test exists for product');
  console.log('   5. ✅ Visit product page with DevTools open');
  console.log('   6. ✅ Check browser console for [A/B Test Pixel] logs');
  console.log('   7. ✅ Check Network tab for API requests');
  console.log('   8. ✅ Check server logs for /track endpoint calls');

  // 5. Debugging steps
  console.log('\n5️⃣ Next Steps for Debugging...\n');
  console.log('   Step 1: Open browser DevTools (F12)');
  console.log('   Step 2: Go to Console tab');
  console.log('   Step 3: Visit product page:');
  activeTests.forEach((test) => {
    console.log(`      Product: ${test.productId}`);
  });
  console.log('\n   Step 4: Look for these logs:');
  console.log('      ✅ [A/B Test Pixel] Initialized');
  console.log('      ✅ [A/B Test Pixel] Product viewed');
  console.log('      ✅ [A/B Test Pixel] Fetching test state...');
  console.log('      ✅ [A/B Test Pixel] Test state result');
  console.log('      ✅ [A/B Test Pixel] Tracking impression...');
  console.log('      ✅ [A/B Test Pixel] Track success');

  console.log('\n   Step 5: Check Network tab (Filter: XHR/Fetch)');
  console.log('      Should see:');
  console.log(`      ✅ GET ${appUrl}/api/rotation-state?productId=...`);
  console.log(`      ✅ POST ${appUrl}/track`);

  console.log('\n   Step 6: Check server logs');
  console.log('      Should see:');
  console.log('      ✅ [Track API] Event tracked successfully');

  console.log('\n   Step 7: Verify in database');
  console.log('      Run: bun run scripts/check-abtestevents.ts');

  if (issues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    issues.forEach((issue) => console.log(`   ${issue}`));
  }

  console.log('\n' + '='.repeat(60));
  await db.$disconnect();
}

main().catch(console.error);
