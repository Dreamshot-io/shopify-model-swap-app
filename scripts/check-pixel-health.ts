#!/usr/bin/env bun
/**
 * Comprehensive pixel health check for all shops
 * Checks: credentials, scopes, pixel config, active tests, recent events
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORRECT_APP_URL = 'https://abtest.dreamshot.io';
const REQUIRED_SCOPES = ['read_customer_events', 'write_pixels'];

interface ShopHealth {
	shop: string;
	checks: {
		hasCredentials: boolean;
		hasSession: boolean;
		hasRequiredScopes: boolean;
		missingScopes: string[];
		pixelConfigured: boolean;
		pixelEnabled: boolean;
		pixelUrlCorrect: boolean;
		pixelUrl: string | null;
		hasActiveTests: boolean;
		activeTestCount: number;
		hasRecentEvents: boolean;
		recentEventCount: number;
		eventsByType: { IMPRESSION: number; ADD_TO_CART: number; PURCHASE: number };
		lastEventAt: Date | null;
	};
	status: 'healthy' | 'warning' | 'error';
	issues: string[];
}

async function checkPixelViaAPI(shop: string, accessToken: string): Promise<{
	configured: boolean;
	enabled: boolean;
	urlCorrect: boolean;
	url: string | null;
	error?: string;
}> {
	try {
		const query = `query { webPixel { id settings } }`;
		const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': accessToken,
			},
			body: JSON.stringify({ query }),
		});

		const data = await response.json();
		const pixel = data.data?.webPixel;

		if (!pixel) {
			return { configured: false, enabled: false, urlCorrect: false, url: null };
		}

		const settings = JSON.parse(pixel.settings);
		return {
			configured: true,
			enabled: settings.enabled === 'true' || settings.enabled === true,
			urlCorrect: settings.app_url === CORRECT_APP_URL,
			url: settings.app_url,
		};
	} catch (error) {
		return {
			configured: false,
			enabled: false,
			urlCorrect: false,
			url: null,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

async function getEventStats(shop: string, shopId: string | null): Promise<{
	total: number;
	byType: { IMPRESSION: number; ADD_TO_CART: number; PURCHASE: number };
	lastEvent: Date | null;
}> {
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Get events linked to tests for this shop
	const events = await prisma.aBTestEvent.findMany({
		where: {
			createdAt: { gte: sevenDaysAgo },
			OR: [
				{ shopId: shopId ?? undefined },
				{ test: { shop: shop } },
			],
		},
		select: { eventType: true, createdAt: true },
		orderBy: { createdAt: 'desc' },
	});

	const byType = { IMPRESSION: 0, ADD_TO_CART: 0, PURCHASE: 0 };
	for (const e of events) {
		if (e.eventType in byType) {
			byType[e.eventType as keyof typeof byType]++;
		}
	}

	return {
		total: events.length,
		byType,
		lastEvent: events[0]?.createdAt ?? null,
	};
}

async function checkShopHealth(credential: {
	id: string;
	shopDomain: string;
	status: string;
}): Promise<ShopHealth> {
	const issues: string[] = [];
	const shop = credential.shopDomain;

	// Get session for this shop
	const session = await prisma.session.findFirst({
		where: { shop },
	});

	// Check scopes
	const scopes = session?.scope?.split(',') ?? [];
	const missingScopes = REQUIRED_SCOPES.filter(s => !scopes.includes(s));

	// Check pixel via API
	let pixelCheck = { configured: false, enabled: false, urlCorrect: false, url: null as string | null };
	if (session?.accessToken) {
		pixelCheck = await checkPixelViaAPI(shop, session.accessToken);
	}

	// Check active tests
	const activeTests = await prisma.aBTest.findMany({
		where: { shop, status: 'ACTIVE' },
		select: { id: true, name: true, productId: true },
	});

	// Check recent events
	const eventStats = await getEventStats(shop, credential.id);

	// Determine issues
	if (!session) {
		issues.push('No session found - app may need reinstall');
	}
	if (missingScopes.length > 0) {
		issues.push(`Missing scopes: ${missingScopes.join(', ')}`);
	}
	if (!pixelCheck.configured) {
		issues.push('Pixel not configured');
	} else {
		if (!pixelCheck.enabled) {
			issues.push('Pixel is disabled');
		}
		if (!pixelCheck.urlCorrect) {
			issues.push(`Wrong pixel URL: ${pixelCheck.url} (should be ${CORRECT_APP_URL})`);
		}
	}
	if (activeTests.length === 0) {
		issues.push('No active A/B tests');
	}
	if (activeTests.length > 0 && eventStats.byType.IMPRESSION === 0) {
		issues.push('Active tests but no impressions in last 7 days');
	}
	if (activeTests.length > 0 && eventStats.byType.ADD_TO_CART === 0 && eventStats.byType.PURCHASE > 0) {
		issues.push('Has purchases but no add-to-cart events - pixel may be misconfigured');
	}

	// Determine overall status
	let status: 'healthy' | 'warning' | 'error' = 'healthy';
	if (issues.some(i => i.includes('No session') || i.includes('Pixel not configured') || i.includes('Wrong pixel URL'))) {
		status = 'error';
	} else if (issues.length > 0) {
		status = 'warning';
	}

	return {
		shop,
		checks: {
			hasCredentials: true,
			hasSession: !!session,
			hasRequiredScopes: missingScopes.length === 0,
			missingScopes,
			pixelConfigured: pixelCheck.configured,
			pixelEnabled: pixelCheck.enabled,
			pixelUrlCorrect: pixelCheck.urlCorrect,
			pixelUrl: pixelCheck.url,
			hasActiveTests: activeTests.length > 0,
			activeTestCount: activeTests.length,
			hasRecentEvents: eventStats.total > 0,
			recentEventCount: eventStats.total,
			eventsByType: eventStats.byType,
			lastEventAt: eventStats.lastEvent,
		},
		status,
		issues,
	};
}

function printShopHealth(health: ShopHealth) {
	const statusIcon = health.status === 'healthy' ? '✅' : health.status === 'warning' ? '⚠️' : '❌';
	console.log(`\n${statusIcon} ${health.shop}`);
	console.log('─'.repeat(60));

	// Credentials & Session
	const sessionIcon = health.checks.hasSession ? '✅' : '❌';
	console.log(`  ${sessionIcon} Session: ${health.checks.hasSession ? 'Active' : 'Missing'}`);

	// Scopes
	const scopeIcon = health.checks.hasRequiredScopes ? '✅' : '❌';
	console.log(`  ${scopeIcon} Scopes: ${health.checks.hasRequiredScopes ? 'OK' : `Missing: ${health.checks.missingScopes.join(', ')}`}`);

	// Pixel
	if (health.checks.pixelConfigured) {
		const enabledIcon = health.checks.pixelEnabled ? '✅' : '⚠️';
		const urlIcon = health.checks.pixelUrlCorrect ? '✅' : '❌';
		console.log(`  ${enabledIcon} Pixel: ${health.checks.pixelEnabled ? 'Enabled' : 'Disabled'}`);
		console.log(`  ${urlIcon} Pixel URL: ${health.checks.pixelUrl}`);
	} else {
		console.log(`  ❌ Pixel: Not configured`);
	}

	// Tests
	const testIcon = health.checks.hasActiveTests ? '✅' : '⚠️';
	console.log(`  ${testIcon} Active Tests: ${health.checks.activeTestCount}`);

	// Events (last 7 days)
	const { IMPRESSION, ADD_TO_CART, PURCHASE } = health.checks.eventsByType;
	const eventsOk = health.checks.hasActiveTests ? IMPRESSION > 0 : true;
	const eventIcon = eventsOk ? '✅' : '❌';
	console.log(`  ${eventIcon} Events (7d): IMP=${IMPRESSION} | ATC=${ADD_TO_CART} | PUR=${PURCHASE}`);
	if (health.checks.lastEventAt) {
		const hoursAgo = Math.round((Date.now() - health.checks.lastEventAt.getTime()) / (1000 * 60 * 60));
		console.log(`     Last event: ${hoursAgo}h ago`);
	}

	// Issues
	if (health.issues.length > 0) {
		console.log(`\n  Issues:`);
		for (const issue of health.issues) {
			console.log(`    • ${issue}`);
		}
	}
}

async function main() {
	console.log('🔍 Pixel Health Check - All Shops\n');
	console.log('='.repeat(60));

	const credentials = await prisma.shopCredential.findMany({
		where: { status: 'ACTIVE' },
		select: { id: true, shopDomain: true, status: true },
	});

	console.log(`Found ${credentials.length} active shops\n`);

	const results: ShopHealth[] = [];
	for (const cred of credentials) {
		const health = await checkShopHealth(cred);
		results.push(health);
		printShopHealth(health);
	}

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('📊 Summary\n');

	const healthy = results.filter(r => r.status === 'healthy').length;
	const warning = results.filter(r => r.status === 'warning').length;
	const error = results.filter(r => r.status === 'error').length;

	console.log(`  ✅ Healthy: ${healthy}`);
	console.log(`  ⚠️  Warning: ${warning}`);
	console.log(`  ❌ Error:   ${error}`);

	// Action items
	const actionItems = results.filter(r => r.status === 'error');
	if (actionItems.length > 0) {
		console.log('\n📋 Action Required:\n');
		for (const item of actionItems) {
			console.log(`  ${item.shop}:`);
			for (const issue of item.issues) {
				console.log(`    → ${issue}`);
			}
		}
	}

	// Fix suggestions
	const wrongUrls = results.filter(r => r.checks.pixelConfigured && !r.checks.pixelUrlCorrect);
	if (wrongUrls.length > 0) {
		console.log('\n🔧 To fix wrong pixel URLs, run:');
		console.log('   bun run scripts/fix-pixel-app-urls.ts');
	}

	const noPixel = results.filter(r => !r.checks.pixelConfigured);
	if (noPixel.length > 0) {
		console.log('\n🔧 To configure missing pixels:');
		console.log('   bun run scripts/activate-pixel-all-shops.ts');
	}

	await prisma.$disconnect();
}

main().catch(console.error);
