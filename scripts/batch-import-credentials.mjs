#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import toml from '@iarna/toml';

const prisma = new PrismaClient();

// Configuration mapping: config file -> env variable patterns
const CONFIGS = [
	{
		configFile: 'shopify.app.toml',
		envPatterns: {
			secret: ['SHOPIFY_API_SECRET'],
			domain: ['SHOPIFY_SHOP_DOMAIN'],
		},
	},
	{
		configFile: 'shopify.app.mims.toml',
		envPatterns: {
			secret: ['SHOP_MIMS_API_SECRET', 'SHOP_MIMS_SECRET', 'MIMS_SHOPIFY_API_SECRET'],
			domain: ['SHOP_MIMS_DOMAIN', 'MIMS_SHOP_DOMAIN'],
		},
	},
	{
		configFile: 'shopify.app.pummba.toml',
		envPatterns: {
			secret: ['SHOP_PUMMBA_API_SECRET', 'SHOP_PUMMBA_SECRET', 'PUMMBA_SHOPIFY_API_SECRET'],
			domain: ['SHOP_PUMMBA_DOMAIN', 'PUMMBA_SHOP_DOMAIN'],
		},
	},
	{
		configFile: 'shopify.app.haanbrand.toml',
		envPatterns: {
			secret: ['SHOP_HAANBRAND_API_SECRET', 'SHOP_HAANBRAND_SECRET', 'HAANBRAND_SHOPIFY_API_SECRET'],
			domain: ['SHOP_HAANBRAND_DOMAIN', 'HAANBRAND_SHOP_DOMAIN'],
		},
	},
];

async function parseEnv() {
	const envPath = path.resolve(process.cwd(), '.env');
	const content = await readFile(envPath, 'utf-8');
	const env = {};

	for (const line of content.split('\n')) {
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

async function importCredential(configFile, shopDomain, apiSecret) {
	const configPath = path.resolve(process.cwd(), configFile);
	const file = await readFile(configPath, 'utf-8');
	const parsed = toml.parse(file);

	const apiKey = parsed.client_id;
	const appUrl = parsed.application_url;
	const appHandle = parsed.handle ?? path.basename(configPath, path.extname(configPath));
	const scopesField = parsed?.access_scopes?.scopes ?? '';
	const scopes = scopesField
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
	const redirectUrls = Array.isArray(parsed?.auth?.redirect_urls) ? parsed.auth.redirect_urls : [];

	if (!apiKey || !appUrl) {
		throw new Error(`Missing client_id or application_url in ${configFile}`);
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
			metadata: { configPath },
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
			metadata: { configPath },
		},
	});

	console.log(`✅ ${credential.shopDomain} (${credential.appHandle})`);
	return credential;
}

async function main() {
	console.log('Reading .env file...\n');
	const env = await parseEnv();

	let imported = 0;
	let skipped = 0;

	for (const { configFile, envPatterns } of CONFIGS) {
		const configPath = path.resolve(process.cwd(), configFile);

		try {
			await readFile(configPath, 'utf-8');
		} catch {
			console.log(`⏭️  ${configFile} (not found)`);
			skipped++;
			continue;
		}

		let apiSecret = null;
		let shopDomain = null;

		for (const pattern of envPatterns.secret) {
			if (env[pattern]) {
				apiSecret = env[pattern];
				break;
			}
		}

		for (const pattern of envPatterns.domain) {
			if (env[pattern]) {
				shopDomain = env[pattern];
				break;
			}
		}

		if (!apiSecret || !shopDomain) {
			console.log(`⚠️  ${configFile} - missing credentials`);
			if (!apiSecret) console.log(`   Secret patterns tried: ${envPatterns.secret.join(', ')}`);
			if (!shopDomain) console.log(`   Domain patterns tried: ${envPatterns.domain.join(', ')}`);
			skipped++;
			continue;
		}

		try {
			await importCredential(configFile, shopDomain, apiSecret);
			imported++;
		} catch (error) {
			console.error(`❌ ${configFile}: ${error.message}`);
			skipped++;
		}
	}

	console.log(`\n✅ Imported: ${imported}, ⏭️  Skipped: ${skipped}`);
}

main()
	.catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
