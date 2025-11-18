#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const prisma = new PrismaClient();

// Default app configuration (from shopify.app.toml)
const DEFAULT_CONFIG = {
	appUrl: 'https://shopify-txl.dreamshot.io',
	appHandle: 'dreamshot-model-swap',
	scopes: [
		'read_orders',
		'write_files',
		'write_products',
		'write_pixels',
		'read_customer_events',
		'write_script_tags',
	],
	redirectUrls: [
		'https://shopify-txl.dreamshot.io/auth/callback',
		'https://shopify-txl.dreamshot.io/auth/shopify/callback',
		'https://shopify-txl.dreamshot.io/api/auth/callback',
	],
	apiVersion: 'January25',
	distribution: 'AppStore',
};

async function parseEnvFile(envPath) {
	const content = await readFile(envPath, 'utf-8');
	const lines = content.split('\n');
	const env = {};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const match = trimmed.match(/^([^=]+)=(.*)$/);
		if (match) {
			const [, key, value] = match;
			env[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
		}
	}

	return env;
}

async function importCredential({ shopDomain, apiKey, apiSecret, ...overrides }) {
	const normalizedDomain = shopDomain.toLowerCase().trim();

	if (!normalizedDomain.endsWith('.myshopify.com')) {
		throw new Error(`Invalid shop domain: ${shopDomain}. Must end with .myshopify.com`);
	}

	if (!apiKey || !apiSecret) {
		throw new Error(`Missing apiKey or apiSecret for ${shopDomain}`);
	}

	const credential = await prisma.shopCredential.upsert({
		where: { shopDomain: normalizedDomain },
		update: {
			apiKey,
			apiSecret,
			appHandle: overrides.appHandle ?? DEFAULT_CONFIG.appHandle,
			appUrl: overrides.appUrl ?? DEFAULT_CONFIG.appUrl,
			scopes: overrides.scopes ?? DEFAULT_CONFIG.scopes,
			redirectUrls: overrides.redirectUrls ?? DEFAULT_CONFIG.redirectUrls,
			apiVersion: overrides.apiVersion ?? DEFAULT_CONFIG.apiVersion,
			distribution: overrides.distribution ?? DEFAULT_CONFIG.distribution,
			status: 'ACTIVE',
		},
		create: {
			shopDomain: normalizedDomain,
			apiKey,
			apiSecret,
			appHandle: overrides.appHandle ?? DEFAULT_CONFIG.appHandle,
			appUrl: overrides.appUrl ?? DEFAULT_CONFIG.appUrl,
			scopes: overrides.scopes ?? DEFAULT_CONFIG.scopes,
			redirectUrls: overrides.redirectUrls ?? DEFAULT_CONFIG.redirectUrls,
			apiVersion: overrides.apiVersion ?? DEFAULT_CONFIG.apiVersion,
			distribution: overrides.distribution ?? DEFAULT_CONFIG.distribution,
			status: 'ACTIVE',
		},
	});

	console.log(`✅ Imported credential for ${credential.shopDomain} (ID: ${credential.id})`);
	return credential;
}

async function main() {
	const envPath = path.resolve(process.cwd(), '.env');
	console.log(`Reading credentials from ${envPath}...\n`);

	try {
		const env = await parseEnvFile(envPath);

		// Look for shop credentials in env file
		// Pattern: SHOPIFY_API_KEY_<SHOP>=xxx, SHOPIFY_API_SECRET_<SHOP>=yyy
		// Or: SHOP_<NAME>_API_KEY, SHOP_<NAME>_API_SECRET, SHOP_<NAME>_DOMAIN
		const credentials = [];

		// Try to find shop credentials
		// Check for pattern like SHOP_*_DOMAIN, SHOP_*_API_KEY, SHOP_*_API_SECRET
		const shopKeys = Object.keys(env).filter(key => key.includes('SHOP') && key.includes('DOMAIN'));

		for (const domainKey of shopKeys) {
			// Extract shop name from key (e.g., SHOP_MIMS_DOMAIN -> MIMS)
			const match = domainKey.match(/SHOP[_-]?([^_]+)[_-]?DOMAIN/i);
			if (!match) continue;

			const shopName = match[1];
			const shopDomain = env[domainKey];

			// Try different patterns for API key and secret
			const apiKeyPatterns = [
				`SHOP_${shopName}_API_KEY`,
				`SHOP_${shopName}_API_SECRET_KEY`,
				`SHOPIFY_API_KEY_${shopName}`,
				`${shopName}_SHOPIFY_API_KEY`,
			];

			const apiSecretPatterns = [
				`SHOP_${shopName}_API_SECRET`,
				`SHOP_${shopName}_SECRET`,
				`SHOPIFY_API_SECRET_${shopName}`,
				`${shopName}_SHOPIFY_API_SECRET`,
			];

			let apiKey = null;
			let apiSecret = null;

			for (const pattern of apiKeyPatterns) {
				if (env[pattern]) {
					apiKey = env[pattern];
					break;
				}
			}

			for (const pattern of apiSecretPatterns) {
				if (env[pattern]) {
					apiSecret = env[pattern];
					break;
				}
			}

			// Fallback: check for single SHOPIFY_API_KEY and SHOPIFY_API_SECRET
			if (!apiKey && shopDomain && env.SHOPIFY_API_KEY) {
				apiKey = env.SHOPIFY_API_KEY;
			}
			if (!apiSecret && shopDomain && env.SHOPIFY_API_SECRET) {
				apiSecret = env.SHOPIFY_API_SECRET;
			}

			if (shopDomain && apiKey && apiSecret) {
				credentials.push({ shopDomain, apiKey, apiSecret });
			}
		}

		// If no shop-specific credentials found, check for single SHOPIFY_API_KEY/SECRET
		// and try to find shop domain from other env vars
		if (credentials.length === 0 && env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET) {
			// Look for shop domain in other variables
			const possibleShopDomain =
				env.SHOPIFY_SHOP_DOMAIN ||
				env.SHOP_DOMAIN ||
				env.SHOPIFY_SHOP ||
				Object.values(env).find(v => typeof v === 'string' && v.includes('.myshopify.com'));

			if (possibleShopDomain) {
				credentials.push({
					shopDomain: possibleShopDomain,
					apiKey: env.SHOPIFY_API_KEY,
					apiSecret: env.SHOPIFY_API_SECRET,
				});
			} else {
				console.warn('⚠️  Found SHOPIFY_API_KEY and SHOPIFY_API_SECRET but no shop domain found.');
				console.warn('Please provide shop domain via --shop-domain argument or SHOPIFY_SHOP_DOMAIN env var.');
			}
		}

		if (credentials.length === 0) {
			console.error('❌ No shop credentials found in .env file.');
			console.error('Expected format:');
			console.error('  SHOP_<NAME>_DOMAIN=shop.myshopify.com');
			console.error('  SHOP_<NAME>_API_KEY=xxx');
			console.error('  SHOP_<NAME>_API_SECRET=yyy');
			console.error('\nOr:');
			console.error('  SHOPIFY_API_KEY=xxx');
			console.error('  SHOPIFY_API_SECRET=yyy');
			console.error('  SHOPIFY_SHOP_DOMAIN=shop.myshopify.com');
			process.exit(1);
		}

		console.log(`Found ${credentials.length} credential(s) to import:\n`);

		for (const cred of credentials) {
			try {
				await importCredential(cred);
			} catch (error) {
				console.error(`❌ Failed to import ${cred.shopDomain}:`, error.message);
			}
		}

		console.log(`\n✅ Import complete!`);
	} catch (error) {
		console.error('Failed to read .env file:', error.message);
		process.exit(1);
	}
}

main()
	.catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
