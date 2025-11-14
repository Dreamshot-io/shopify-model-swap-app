#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Default app configuration (from shopify.app.toml)
const DEFAULT_CONFIG = {
	appUrl: "https://shopify-txl.dreamshot.io",
	appHandle: "dreamshot-model-swap",
	scopes: [
		"read_orders",
		"write_files",
		"write_products",
		"write_pixels",
		"read_customer_events",
		"write_script_tags",
	],
	redirectUrls: [
		"https://shopify-txl.dreamshot.io/auth/callback",
		"https://shopify-txl.dreamshot.io/auth/shopify/callback",
		"https://shopify-txl.dreamshot.io/api/auth/callback",
	],
	apiVersion: "January25",
	distribution: "AppStore",
};

// Credentials to import - update this array with your credentials
const CREDENTIALS = [
	// Format: { shopDomain: "shop.myshopify.com", apiKey: "...", apiSecret: "..." }
	// Add your credentials here
];

async function importCredential({ shopDomain, apiKey, apiSecret, ...overrides }) {
	const normalizedDomain = shopDomain.toLowerCase().trim();

	if (!normalizedDomain.endsWith(".myshopify.com")) {
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
			status: "ACTIVE",
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
			status: "ACTIVE",
		},
	});

	console.log(`✅ Imported credential for ${credential.shopDomain} (ID: ${credential.id})`);
	return credential;
}

async function main() {
	// Read from command line arguments or environment variables
	const args = process.argv.slice(2);

	if (args.length === 0 && CREDENTIALS.length === 0) {
		console.error("No credentials provided. Either:");
		console.error("1. Update CREDENTIALS array in this script");
		console.error("2. Use: node scripts/import-credentials.mjs --shop-domain=shop.myshopify.com --api-key=xxx --api-secret=yyy");
		console.error("3. Set env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_API_KEY, SHOPIFY_API_SECRET");
		process.exit(1);
	}

	const credentialsToImport = [];

	// Parse command line arguments
	if (args.length > 0) {
		const argMap = new Map();
		args.forEach((arg) => {
			const [key, value] = arg.split("=");
			if (key && value) {
				argMap.set(key.replace(/^--/, ""), value);
			}
		});

		const shopDomain = argMap.get("shop-domain") || process.env.SHOPIFY_SHOP_DOMAIN;
		const apiKey = argMap.get("api-key") || process.env.SHOPIFY_API_KEY;
		const apiSecret = argMap.get("api-secret") || process.env.SHOPIFY_API_SECRET;

		if (shopDomain && apiKey && apiSecret) {
			credentialsToImport.push({ shopDomain, apiKey, apiSecret });
		}
	}

	// Add credentials from CREDENTIALS array
	credentialsToImport.push(...CREDENTIALS);

	if (credentialsToImport.length === 0) {
		console.error("No valid credentials found to import");
		process.exit(1);
	}

	console.log(`Importing ${credentialsToImport.length} credential(s)...\n`);

	for (const cred of credentialsToImport) {
		try {
			await importCredential(cred);
		} catch (error) {
			console.error(`❌ Failed to import ${cred.shopDomain}:`, error.message);
		}
	}

	console.log(`\n✅ Import complete!`);
}

main()
	.catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
