#!/usr/bin/env bun
/**
 * Syncs scopes from Shopify (actual granted scopes) to ShopCredential records in DB.
 * Queries each shop's appInstallation.accessScopes and updates the DB.
 *
 * Usage:
 *   bun scripts/sync-scopes-from-shopify.ts          # Dry run
 *   bun scripts/sync-scopes-from-shopify.ts --apply  # Apply changes
 */

import { getShopifyContextByShopDomain } from '../app/shopify.server';
import prisma from '../app/db.server';

const dryRun = !process.argv.includes('--apply');

interface AccessScope {
	handle: string;
}

async function getGrantedScopes(shopDomain: string): Promise<string[] | null> {
	try {
		const credential = await prisma.shopCredential.findFirst({
			where: { shopDomain },
		});

		if (!credential) return null;

		const session = await prisma.session.findFirst({
			where: { shopId: credential.id, isOnline: false },
			orderBy: { expires: 'desc' },
		});

		if (!session) return null;

		const { app } = await getShopifyContextByShopDomain(shopDomain);
		const { admin } = await app.unauthenticated.admin(session.shop);

		const response = await admin.graphql(`
			query {
				appInstallation {
					accessScopes {
						handle
					}
				}
			}
		`);

		const data = await response.json();
		const scopes = data.data?.appInstallation?.accessScopes as AccessScope[] | undefined;

		return scopes?.map(s => s.handle) ?? null;
	} catch {
		return null;
	}
}

async function main() {
	if (dryRun) {
		console.log('DRY RUN - pass --apply to make changes\n');
	}

	const credentials = await prisma.shopCredential.findMany({
		where: { status: 'ACTIVE' },
		select: { id: true, shopDomain: true, scopes: true, appHandle: true },
	});

	console.log(`Found ${credentials.length} active credentials\n`);
	console.log('─'.repeat(80));

	let updated = 0;
	let unchanged = 0;
	let failed = 0;

	for (const cred of credentials) {
		const shopifyScopes = await getGrantedScopes(cred.shopDomain);

		if (!shopifyScopes) {
			console.log(`⚠️  ${cred.shopDomain} - could not fetch scopes (no session or API error)`);
			failed++;
			continue;
		}

		const dbScopes = [...cred.scopes].sort();
		const grantedScopes = [...shopifyScopes].sort();
		const scopesMatch = JSON.stringify(dbScopes) === JSON.stringify(grantedScopes);

		if (scopesMatch) {
			console.log(`✓  ${cred.shopDomain} - scopes match (${dbScopes.length} scopes)`);
			unchanged++;
		} else {
			console.log(`⚡ ${cred.shopDomain} (${cred.appHandle})`);
			console.log(`   DB:      [${dbScopes.join(', ')}]`);
			console.log(`   Shopify: [${grantedScopes.join(', ')}]`);

			if (!dryRun) {
				await prisma.shopCredential.update({
					where: { id: cred.id },
					data: { scopes: shopifyScopes },
				});
				console.log(`   → Updated`);
			} else {
				console.log(`   → Would update`);
			}
			updated++;
		}
	}

	console.log('─'.repeat(80));
	console.log(`\nSummary: ${updated} to update, ${unchanged} unchanged, ${failed} failed`);

	if (dryRun && updated > 0) {
		console.log('\nRun with --apply to apply changes');
	}
}

main()
	.catch(err => {
		console.error('Error:', err);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
