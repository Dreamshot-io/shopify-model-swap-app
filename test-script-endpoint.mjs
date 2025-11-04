#!/usr/bin/env node

/**
 * Test script to verify the theme-aware image replacer endpoints
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';

async function testScriptEndpoint() {
  console.log('Testing script endpoints...\n');

  // Test cases
  const tests = [
    { 
      name: 'Default (enhanced) version',
      url: `${BASE_URL}/script`,
      expectedVersion: '2.0.0-enhanced'
    },
    {
      name: 'Explicit enhanced version',
      url: `${BASE_URL}/script?version=enhanced`,
      expectedVersion: '2.0.0-enhanced'
    },
    {
      name: 'Original version',
      url: `${BASE_URL}/script?version=original`,
      expectedVersion: '1.0.0-original'
    }
  ];

  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    console.log(`URL: ${test.url}`);
    
    try {
      const response = await fetch(test.url);
      
      if (!response.ok) {
        console.error(`❌ Failed: HTTP ${response.status}`);
        continue;
      }

      const scriptContent = await response.text();
      const version = response.headers.get('x-script-version');
      const themeAware = response.headers.get('x-theme-aware');
      const size = response.headers.get('x-script-size');
      
      console.log(`✅ Success:`);
      console.log(`   Version: ${version}`);
      console.log(`   Theme-Aware: ${themeAware}`);
      console.log(`   Size: ${size}`);
      console.log(`   Content preview: ${scriptContent.substring(0, 100)}...`);
      
      if (version !== test.expectedVersion) {
        console.warn(`   ⚠️  Expected version ${test.expectedVersion}, got ${version}`);
      }
      
      // Check for theme detection in enhanced version
      if (themeAware === 'true') {
        const hasThemeDetection = scriptContent.includes('THEME_CONFIGS');
        console.log(`   Theme Detection: ${hasThemeDetection ? '✅' : '❌'}`);
      }
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    console.log('');
  }
}

// Run tests
testScriptEndpoint().catch(console.error);