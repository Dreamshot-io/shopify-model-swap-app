#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { PrismaClient } from '@prisma/client';
import toml from '@iarna/toml';

const prisma = new PrismaClient();

const argMap = new Map(
	process.argv.slice(2).map(arg => {
		const [key, value] = arg.split('=');
		return [key.replace(/^--/, ''), value ?? true];
	}),
);

function getArg(name, fallback) {
	if (argMap.has(name)) {
		return argMap.get(name);
	}

	return fallback;
}

async function main() {
	const configPath = path.resolve(process.cwd(), getArg('config', 'shopify.app.toml'));
	const shopDomain = getArg('shop-domain');
	const apiSecret = getArg('api-secret', process.env.SHOPIFY_API_SECRET);
	const statusInput = (getArg('status', 'ACTIVE') ?? 'ACTIVE').toString().toUpperCase();
	const status = statusInput === 'DISABLED' ? 'DISABLED' : 'ACTIVE';

	if (!shopDomain) {
		console.error('Missing required --shop-domain argument');
		process.exit(1);
	}

	if (!apiSecret) {
		console.error('Missing API secret. Provide via --api-secret or SHOPIFY_API_SECRET env var.');
		process.exit(1);
	}

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

	if (!apiKey || !appUrl) {
		console.error('Config file is missing client_id or application_url');
		process.exit(1);
	}

	const redirectUrls = Array.isArray(parsed?.auth?.redirect_urls) ? parsed.auth.redirect_urls : [];

	const credential = await prisma.shopCredential.upsert({
		where: { apiKey },
		update: {
			apiKey,
			apiSecret,
			appHandle,
			appUrl,
			scopes,
			redirectUrls,
			status,
			metadata: {
				...(parsed.metadata ?? {}),
				configPath: path.relative(process.cwd(), configPath),
			},
		},
		create: {
			shopDomain: shopDomain.toLowerCase(),
			apiKey,
			apiSecret,
			appHandle,
			appUrl,
			scopes,
			redirectUrls,
			status,
			metadata: {
				...(parsed.metadata ?? {}),
				configPath: path.relative(process.cwd(), configPath),
			},
		},
	});

	console.log('Shop credential stored:', {
		id: credential.id,
		shopDomain: credential.shopDomain,
		apiKey: credential.apiKey,
		status: credential.status,
	});
}

main()
	.catch(error => {
		console.error('Failed to seed shop credential:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
