#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import toml from '@iarna/toml';

const prisma = new PrismaClient();

async function parseEnvFile(envPath) {
	try {
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
	} catch (error) {
		console.error(`Failed to read .env file: ${error.message}`);
		return {};
	}
}

async function importFromConfig(configPath, shopDomain, apiSecret) {
	const file = await readFile(configPath, 'utf-8');
	const parsed = toml.parse(file);

	const apiKey = parsed.client_id;
	const appUrl = parsed.application_url;
	const appHandle = parsed.handle ?? path.basename(configPath, path.extname(configPath));
	const scopesField = parsed?.access_scopes?.scopes ?? '';
	const scopes = scopesField
		.split(',')
		.map(scope => scope.trim())
		.filter(Boolean);

	const redirectUrls = Array.isArray(parsed?.auth?.redirect_urls) ? parsed.auth.redirect_urls : [];

	if (!apiKey || !appUrl) {
		throw new Error(`Config file ${configPath} is missing client_id or application_url`);
	}

	const normalizedDomain = shopDomain.toLowerCase().trim();

	const credential = await prisma['shopCredential'].upsert({
		where: { shopDomain: normalizedDomain },
		update: {
			apiKey,
			apiSecret,
			appHandle,
			appUrl,
			scopes,
			redirectUrls,
			status: 'ACTIVE',
			metadata: {
				configPath: path.relative(process.cwd(), configPath),
			},
		},
		create: {
			shopDomain: normalizedDomain,
			apiKey,
			apiSecret,
			appHandle,
			appUrl,
			scopes,
			redirectUrls,
			status: 'ACTIVE',
			metadata: {
				configPath: path.relative(process.cwd(), configPath),
			},
		},
	});

	console.log(`✅ Imported: ${credential.shopDomain} (${credential.appHandle})`);
	return credential;
}

async function main() {
	const envPath = path.resolve(process.cwd(), '.env');
	console.log(`Reading credentials from ${envPath}...\n`);

	const env = await parseEnvFile(envPath);

	// Find all shopify.app.*.toml files
	const configFiles = [
		'shopify.app.toml',
		'shopify.app.mims.toml',
		'shopify.app.pummba.toml',
		'shopify.app.haanbrand.toml',
	];

	const credentials = [];

	for (const configFile of configFiles) {
		const configPath = path.resolve(process.cwd(), configFile);

		try {
			// Try to read the config file
			await readFile(configPath, 'utf-8');
		} catch {
			console.log(`⏭️  Skipping ${configFile} (not found)`);
			continue;
		}

		// Extract shop name from filename (e.g., shopify.app.mims.toml -> mims)
		const shopName = configFile.replace('shopify.app.', '').replace('.toml', '').toUpperCase();

		// Try different patterns to find API secret
		const secretPatterns = [
			`SHOP_${shopName}_API_SECRET`,
			`SHOP_${shopName}_SECRET`,
			`${shopName}_SHOPIFY_API_SECRET`,
			`SHOPIFY_API_SECRET_${shopName}`,
			// Fallback to main secret
			`SHOPIFY_API_SECRET`,
		];

		const domainPatterns = [
			`SHOP_${shopName}_DOMAIN`,
			`${shopName}_SHOP_DOMAIN`,
			`SHOPIFY_SHOP_DOMAIN_${shopName}`,
		];

		let apiSecret = null;
		let shopDomain = null;

		for (const pattern of secretPatterns) {
			if (env[pattern]) {
				apiSecret = env[pattern];
				break;
			}
		}

		for (const pattern of domainPatterns) {
			if (env[pattern]) {
				shopDomain = env[pattern];
				break;
			}
		}

		// If no domain found, try to infer from shop name
		if (!shopDomain && shopName !== 'TOM') {
			// Try common patterns
			const possibleDomain = `${shopName.toLowerCase()}.myshopify.com`;
			shopDomain = possibleDomain;
		}

		if (apiSecret && shopDomain) {
			credentials.push({ configFile, shopDomain, apiSecret });
		} else {
			console.log(`⚠️  Skipping ${configFile}: missing API secret or domain`);
			if (!apiSecret) console.log(`   Missing: API secret (tried: ${secretPatterns.join(', ')})`);
			if (!shopDomain) console.log(`   Missing: Shop domain (tried: ${domainPatterns.join(', ')})`);
		}
	}

	if (credentials.length === 0) {
		console.error('\n❌ No credentials found to import.');
		console.error('\nExpected .env format:');
		console.error('  SHOP_MIMS_DOMAIN=mims.myshopify.com');
		console.error('  SHOP_MIMS_API_SECRET=xxx');
		console.error('  SHOP_PUMMBA_DOMAIN=pummba.myshopify.com');
		console.error('  SHOP_PUMMBA_API_SECRET=yyy');
		process.exit(1);
	}

	console.log(`\nFound ${credentials.length} credential(s) to import:\n`);

	for (const { configFile, shopDomain, apiSecret } of credentials) {
		try {
			await importFromConfig(configFile, shopDomain, apiSecret);
		} catch (error) {
			console.error(`❌ Failed to import ${configFile}:`, error.message);
		}
	}

	console.log(`\n✅ Import complete!`);
}

main()
	.catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
