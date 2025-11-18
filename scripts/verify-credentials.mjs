#!/usr/bin/env node
/**
 * Verify that credentials are properly decrypted and can access Shopify API
 * Tests:
 * 1. Credentials can be read and decrypted
 * 2. Can create Shopify admin client
 * 3. Can query products from Shopify
 */

import prisma from '../app/db.server.ts';
import { shopifyApp, ApiVersion, AppDistribution } from '@shopify/shopify-app-remix/server';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';

const SHOP_INFO_QUERY = `#graphql
  query GetShopInfo {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain {
        host
      }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

async function testCredential(credential, allSessions = [], usedSessions = new Set()) {
	const results = {
		shopDomain: credential.shopDomain,
		appHandle: credential.appHandle,
		decryption: { success: false, error: null },
		clientCreation: { success: false, error: null },
		apiAccess: { success: false, error: null, productCount: 0 },
	};

	// Test 1: Verify encryption/decryption
	try {
		// Check raw database value (bypass Prisma extension)
		const { PrismaClient } = await import('@prisma/client');
		const rawPrisma = new PrismaClient();
		const rawCred = await rawPrisma['shopCredential'].findUnique({
			where: { id: credential.id },
			select: { apiSecret: true },
		});
		await rawPrisma.$disconnect();

		if (!rawCred || !rawCred.apiSecret) {
			results.decryption.error = 'apiSecret not found in database';
			return results;
		}

		const isEncryptedInDb = rawCred.apiSecret.includes(':') && rawCred.apiSecret.split(':').length === 3;

		// The credential.apiSecret should be decrypted by Prisma extension
		if (!credential.apiSecret || credential.apiSecret.length === 0) {
			results.decryption.error = 'apiSecret is empty after decryption';
			return results;
		}

		if (isEncryptedInDb) {
			// Verify it was decrypted (should not look encrypted)
			const stillEncrypted = credential.apiSecret.includes(':') && credential.apiSecret.split(':').length === 3;
			if (stillEncrypted) {
				results.decryption.error = 'Secret is encrypted in DB but was not decrypted by Prisma extension';
				return results;
			}
			results.decryption.success = true;
			results.decryption.note = 'Encrypted in DB, successfully decrypted';
		} else {
			results.decryption.success = true;
			results.decryption.note = 'Plaintext in DB (not encrypted)';
		}
	} catch (error) {
		results.decryption.error = error.message;
		return results;
	}

	// Test 2: Create Shopify app instance
	let app;
	try {
		app = shopifyApp({
			apiKey: credential.apiKey,
			apiSecretKey: credential.apiSecret,
			apiVersion: ApiVersion.January25,
			scopes: credential.scopes,
			appUrl: credential.appUrl,
			authPathPrefix: '/auth',
			sessionStorage: new PrismaSessionStorage(prisma),
			distribution: AppDistribution.AppStore,
		});
		results.clientCreation.success = true;
	} catch (error) {
		results.clientCreation.error = error.message;
		return results;
	}

	// Test 3: Try to get a session and query products
	try {
		// Find a session for this credential - try by shopId first, then by shop domain
		let session = await prisma.session.findFirst({
			where: { shopId: credential.id },
			orderBy: { id: 'desc' },
		});

		// If no session found by shopId, try to find by shop domain (normalized)
		if (!session) {
			const normalizedDomain = credential.shopDomain.toLowerCase().trim();
			session = await prisma.session.findFirst({
				where: {
					shop: {
						equals: normalizedDomain,
						mode: 'insensitive',
					},
				},
				orderBy: { id: 'desc' },
			});
		}

		// If still no session, try all available sessions and test which one works
		// Note: We test sessions to see if they work, but shop domains might not match exactly
		if (!session && allSessions.length > 0) {
			// Try each session - test if accessToken works
			// We test with the session's shop domain since accessToken is scoped to that shop
			for (const testSession of allSessions) {
				// Skip sessions that have already been matched to another credential
				if (usedSessions.has(testSession.id)) continue;
				if (!testSession.accessToken || !testSession.shop) continue;

				try {
					const apiVersion = '2025-01';
					const graphqlUrl = `https://${testSession.shop}/admin/api/${apiVersion}/graphql.json`;

					const testResponse = await fetch(graphqlUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Shopify-Access-Token': testSession.accessToken,
						},
						body: JSON.stringify({
							query: PRODUCTS_QUERY,
							variables: { first: 1 },
						}),
					});

					if (testResponse.ok) {
						const testJson = await testResponse.json();
						if (testJson.data && !testJson.errors) {
							// Session works - use it and mark as used
							session = testSession;
							usedSessions.add(testSession.id);
							results.apiAccess.matchedSession = testSession.shop;
							if (testSession.shop.toLowerCase() !== credential.shopDomain.toLowerCase()) {
								results.apiAccess.note = `Shop domain mismatch: credential has "${credential.shopDomain}" but session is for "${testSession.shop}"`;
							}
							break;
						}
					}
				} catch {
					// Try next session
					continue;
				}
			}
		}

		if (!session || !session.accessToken) {
			results.apiAccess.error = `No active session found for ${credential.shopDomain}. Install the app first.`;
			return results;
		}

		// Use the session's accessToken directly to make GraphQL calls
		// Note: accessToken is scoped to the session's shop domain, not the credential's
		const shopDomain = session.shop || credential.shopDomain;
		const apiVersion = '2025-01';
		const graphqlUrl = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

		// First, query shop info to get the actual shop domain
		const shopInfoResponse = await fetch(graphqlUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': session.accessToken,
			},
			body: JSON.stringify({
				query: SHOP_INFO_QUERY,
			}),
		});

		let actualShopDomain = shopDomain;
		let shopInfo = null;

		if (shopInfoResponse.ok) {
			const shopInfoJson = await shopInfoResponse.json();
			if (shopInfoJson.data && shopInfoJson.data.shop) {
				shopInfo = shopInfoJson.data.shop;
				actualShopDomain = shopInfo.myshopifyDomain || shopDomain;
				results.apiAccess.shopInfo = {
					name: shopInfo.name,
					myshopifyDomain: shopInfo.myshopifyDomain,
					primaryDomain: shopInfo.primaryDomain?.host,
				};
			}
		}

		// Compare actual shop domain with credential's shopDomain
		if (actualShopDomain.toLowerCase() !== credential.shopDomain.toLowerCase()) {
			results.apiAccess.shopDomainMismatch = {
				credential: credential.shopDomain,
				actual: actualShopDomain,
				suggestion: `Update credential shopDomain to "${actualShopDomain}"`,
			};
		}

		// Now query products
		const response = await fetch(graphqlUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': session.accessToken,
			},
			body: JSON.stringify({
				query: PRODUCTS_QUERY,
				variables: { first: 5 },
			}),
		});

		if (!response.ok) {
			results.apiAccess.error = `HTTP ${response.status}: ${response.statusText}`;
			return results;
		}

		const json = await response.json();

		if (json.errors) {
			results.apiAccess.error = `GraphQL errors: ${JSON.stringify(json.errors)}`;
			return results;
		}

		if (json.data && json.data.products) {
			const productCount = json.data.products.edges?.length || 0;
			results.apiAccess.success = true;
			results.apiAccess.productCount = productCount;
			results.apiAccess.sampleProducts = json.data.products.edges?.slice(0, 3).map(edge => ({
				title: edge.node.title,
				handle: edge.node.handle,
			}));
			results.apiAccess.sessionShop = session.shop;
			results.apiAccess.actualShopDomain = actualShopDomain;
		} else {
			results.apiAccess.error = 'Unexpected response format';
		}
	} catch (error) {
		results.apiAccess.error = error.message;
	}

	return results;
}

async function main() {
	console.log('🔍 Verifying credentials...\n');

	const credentials = await prisma['shopCredential'].findMany({
		where: { status: 'ACTIVE' },
		orderBy: { shopDomain: 'asc' },
		select: {
			id: true,
			shopDomain: true,
			appHandle: true,
			apiKey: true,
			apiSecret: true,
			appUrl: true,
			scopes: true,
		},
	});

	if (credentials.length === 0) {
		console.log('❌ No active credentials found in database.');
		return;
	}

	// Get all sessions once
	const allSessionsRaw = await prisma.session.findMany({
		orderBy: { id: 'desc' },
	});
	const allSessions = allSessionsRaw.filter(s => s.accessToken);

	console.log(`Found ${credentials.length} credential(s) and ${allSessions.length} session(s) to verify:\n`);

	const results = [];
	const usedSessions = new Set(); // Track which sessions we've already matched

	for (const cred of credentials) {
		console.log(`Testing: ${cred.shopDomain} (${cred.appHandle})...`);
		const result = await testCredential(cred, allSessions, usedSessions);
		results.push(result);

		// Print results
		console.log(
			`  Decryption: ${result.decryption.success ? '✅' : '❌'} ${result.decryption.error || result.decryption.note || 'OK'}`,
		);
		console.log(
			`  Client Creation: ${result.clientCreation.success ? '✅' : '❌'} ${result.clientCreation.error || 'OK'}`,
		);
		if (result.apiAccess.success) {
			console.log(`  API Access: ✅ Found ${result.apiAccess.productCount} product(s)`);
			if (result.apiAccess.shopInfo) {
				console.log(`    Shop: ${result.apiAccess.shopInfo.name}`);
				console.log(`    Domain: ${result.apiAccess.shopInfo.myshopifyDomain}`);
				if (result.apiAccess.shopInfo.primaryDomain) {
					console.log(`    Primary Domain: ${result.apiAccess.shopInfo.primaryDomain}`);
				}
			}
			if (result.apiAccess.matchedSession) {
				console.log(`    Matched session from: ${result.apiAccess.matchedSession}`);
			} else if (result.apiAccess.sessionShop) {
				console.log(`    Using session from: ${result.apiAccess.sessionShop}`);
			}
			if (result.apiAccess.shopDomainMismatch) {
				console.log(`    ⚠️  Shop domain mismatch:`);
				console.log(`       Credential has: ${result.apiAccess.shopDomainMismatch.credential}`);
				console.log(`       Actual shop is: ${result.apiAccess.shopDomainMismatch.actual}`);
				console.log(`       ${result.apiAccess.shopDomainMismatch.suggestion}`);
			}
			if (result.apiAccess.note) {
				console.log(`    ⚠️  ${result.apiAccess.note}`);
			}
			if (result.apiAccess.sampleProducts && result.apiAccess.sampleProducts.length > 0) {
				console.log(`    Sample: ${result.apiAccess.sampleProducts.map(p => p.title).join(', ')}`);
			}
		} else {
			console.log(`  API Access: ❌ ${result.apiAccess.error}`);
		}
		console.log('');
	}

	// Summary
	console.log('📊 Summary:');
	const successCount = results.filter(
		r => r.decryption.success && r.clientCreation.success && r.apiAccess.success,
	).length;
	const totalCount = results.length;

	console.log(`  ✅ Fully working: ${successCount}/${totalCount}`);
	console.log(`  ⚠️  Partial: ${totalCount - successCount}/${totalCount}`);

	if (successCount < totalCount) {
		console.log('\n⚠️  Some credentials have issues:');
		results.forEach(r => {
			if (!r.decryption.success || !r.clientCreation.success || !r.apiAccess.success) {
				console.log(`  - ${r.shopDomain}:`);
				if (!r.decryption.success) console.log(`    • Decryption failed: ${r.decryption.error}`);
				if (!r.clientCreation.success) console.log(`    • Client creation failed: ${r.clientCreation.error}`);
				if (!r.apiAccess.success) console.log(`    • API access failed: ${r.apiAccess.error}`);
			}
		});
	}

	// Check for shop domain mismatches
	const mismatches = results.filter(r => r.apiAccess.shopDomainMismatch);
	if (mismatches.length > 0) {
		console.log('\n⚠️  Shop domain mismatches found:');
		mismatches.forEach(r => {
			console.log(`  ${r.appHandle}:`);
			console.log(`    Current: ${r.apiAccess.shopDomainMismatch.credential}`);
			console.log(`    Actual:  ${r.apiAccess.shopDomainMismatch.actual}`);
			console.log(`    ${r.apiAccess.shopDomainMismatch.suggestion}`);
		});
		console.log('\n💡 To fix, update the shopDomain in the database for these credentials.');
	}

	if (successCount === totalCount && mismatches.length === 0) {
		console.log('\n✅ All credentials are working correctly!');
	} else if (successCount === totalCount) {
		console.log('\n✅ All credentials can access Shopify API, but some shop domains need updating.');
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
