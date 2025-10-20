#!/usr/bin/env node

/**
 * Test script to verify the upload endpoint is working
 * This script makes actual HTTP requests to test the upload flow
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
	// Update this to match your dev server
	APP_URL: 'http://localhost:3000',
	PRODUCT_ID: 'gid://shopify/Product/14764565168459',
	TEST_IMAGE_JPG: path.join(__dirname, '5aa62579-8b5a-4a38-b9ab-542b2c44ddd3 (1).jpg'),
	TEST_IMAGE_WEBP: path.join(__dirname, 'maddie.webp'),
};

const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testUploadEndpoint(imagePath, imageType) {
	const fileName = path.basename(imagePath);
	log(`\nTesting upload: ${fileName}`, 'cyan');

	try {
		// Read the file
		const fileBuffer = fs.readFileSync(imagePath);
		log(`  File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`, 'blue');

		// Create FormData
		const formData = new FormData();
		const blob = new Blob([fileBuffer], { type: imageType });
		formData.append('intent', 'upload');
		formData.append('file', blob, fileName);
		formData.append('productId', TEST_CONFIG.PRODUCT_ID);

		// Log the request details
		log('  Request details:', 'yellow');
		log(`    URL: ${TEST_CONFIG.APP_URL}/app/ai-studio`, 'blue');
		log(`    Method: POST`, 'blue');
		log(`    Content-Type: multipart/form-data`, 'blue');
		log(`    File type: ${imageType}`, 'blue');

		// Make the actual request
		log('  Making request...', 'cyan');
		const response = await fetch(`${TEST_CONFIG.APP_URL}/app/ai-studio`, {
			method: 'POST',
			body: formData,
		});

		log(`  Response status: ${response.status} ${response.statusText}`, response.ok ? 'green' : 'red');

		// Try to parse response
		const contentType = response.headers.get('content-type');
		log(`  Response content-type: ${contentType}`, 'blue');

		if (contentType?.includes('application/json')) {
			const result = await response.json();
			log('  Response body:', 'yellow');
			console.log(JSON.stringify(result, null, 2));

			if (result.ok) {
				log('  ✓ Upload successful!', 'green');
				return true;
			} else {
				log(`  ✗ Upload failed: ${result.error}`, 'red');
				return false;
			}
		} else if (contentType?.includes('text/html')) {
			log('  ⚠ Received HTML response (might be login page or error page)', 'yellow');
			const text = await response.text();
			// Check for common error indicators in HTML
			if (text.includes('login') || text.includes('authenticate')) {
				log('  ℹ Authentication required - you may need to be logged into the Shopify app', 'yellow');
			} else if (text.includes('error') || text.includes('Error')) {
				log('  ℹ Error page returned', 'yellow');
			}
			return false;
		} else {
			const text = await response.text();
			log(`  Response: ${text.substring(0, 200)}...`, 'blue');
			return false;
		}
	} catch (error) {
		log(`  ✗ Request failed: ${error.message}`, 'red');
		if (error.cause) {
			log(`    Cause: ${error.cause}`, 'red');
		}
		return false;
	}
}

async function checkServerStatus() {
	log('\n🔍 Checking server status...', 'cyan');

	try {
		const response = await fetch(TEST_CONFIG.APP_URL);
		if (response.ok) {
			log('  ✓ Server is running', 'green');
			return true;
		} else {
			log(`  ⚠ Server responded with status ${response.status}`, 'yellow');
			return true; // Server is running but may have issues
		}
	} catch (error) {
		log('  ✗ Server is not running or not accessible', 'red');
		log(`    Error: ${error.message}`, 'red');
		return false;
	}
}

async function main() {
	console.clear();
	log('🔬 UPLOAD ENDPOINT TEST', 'bright');
	log('Testing actual HTTP upload endpoint\n', 'cyan');

	// Check if server is running
	const serverRunning = await checkServerStatus();
	if (!serverRunning) {
		log('\n❌ Server is not running!', 'red');
		log('Please start the development server first:', 'yellow');
		log('  bun run dev', 'cyan');
		process.exit(1);
	}

	// Check if files exist
	if (!fs.existsSync(TEST_CONFIG.TEST_IMAGE_JPG)) {
		log(`❌ JPG test file not found: ${TEST_CONFIG.TEST_IMAGE_JPG}`, 'red');
		process.exit(1);
	}

	if (!fs.existsSync(TEST_CONFIG.TEST_IMAGE_WEBP)) {
		log(`❌ WEBP test file not found: ${TEST_CONFIG.TEST_IMAGE_WEBP}`, 'red');
		process.exit(1);
	}

	// Test JPG upload
	const jpgSuccess = await testUploadEndpoint(TEST_CONFIG.TEST_IMAGE_JPG, 'image/jpeg');

	// Test WEBP upload
	const webpSuccess = await testUploadEndpoint(TEST_CONFIG.TEST_IMAGE_WEBP, 'image/webp');

	// Summary
	log('\n📊 Test Results:', 'bright');
	log(`  JPG upload: ${jpgSuccess ? '✓ Success' : '✗ Failed'}`, jpgSuccess ? 'green' : 'red');
	log(`  WEBP upload: ${webpSuccess ? '✓ Success' : '✗ Failed'}`, webpSuccess ? 'green' : 'red');

	if (!jpgSuccess || !webpSuccess) {
		log('\n⚠ Upload issues detected!', 'yellow');
		log('\nPossible causes:', 'cyan');
		log('  1. Server not properly configured', 'blue');
		log('  2. Authentication required (need to be logged into Shopify)', 'blue');
		log('  3. CORS or security restrictions', 'blue');
		log('  4. Missing environment variables (SHOPIFY_API_KEY, etc)', 'blue');
		log('  5. Database connection issues', 'blue');

		log('\nTo debug further:', 'cyan');
		log('  1. Check server logs for errors', 'blue');
		log('  2. Ensure you are logged into the Shopify app', 'blue');
		log('  3. Try uploading manually through the UI', 'blue');
		log('  4. Check network tab in browser DevTools', 'blue');
	} else {
		log('\n✅ All uploads successful!', 'green');
		log('The upload endpoint is working correctly.', 'green');
	}
}

// Run the test
main().catch(error => {
	log(`\n❌ Fatal error: ${error.message}`, 'red');
	console.error(error);
	process.exit(1);
});
