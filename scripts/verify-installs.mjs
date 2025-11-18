#!/usr/bin/env node
/**
 * Comprehensive verification of credentials, installs, and shop information
 * Maps credentials to sessions and shops to identify mismatches
 */

import prisma from '../app/db.server.ts';

const SHOP_INFO_QUERY = `#graphql
  query GetShopInfo {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain {
        host
      }
      plan {
        displayName
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
    }
  }
`;

const APP_INSTALLATIONS_QUERY = `#graphql
  query GetAppInstallations {
    appInstallations(first: 250) {
      edges {
        node {
          id
          launchUrl
          app {
            id
            title
            apiKey
          }
          activeSubscriptions {
            name
            status
            test
            currentPeriodEnd
          }
        }
      }
    }
  }
`;

async function getShopInfoFromSession(session) {
	if (!session.accessToken || !session.shop) {
		return null;
	}

	try {
		const apiVersion = '2025-01';
		const graphqlUrl = `https://${session.shop}/admin/api/${apiVersion}/graphql.json`;

		// Fetch shop info
		const shopResponse = await fetch(graphqlUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': session.accessToken,
			},
			body: JSON.stringify({
				query: SHOP_INFO_QUERY,
			}),
		});

		let shopInfo = null;
		if (shopResponse.ok) {
			const shopJson = await shopResponse.json();
			if (shopJson.data && shopJson.data.shop) {
				shopInfo = shopJson.data.shop;
			}
		}

		// Fetch products to verify installation works
		const productsResponse = await fetch(graphqlUrl, {
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

		let products = [];
		if (productsResponse.ok) {
			const productsJson = await productsResponse.json();
			if (productsJson.data && productsJson.data.products) {
				products = productsJson.data.products.edges.map(edge => ({
					title: edge.node.title,
					handle: edge.node.handle,
				}));
			}
		}

		if (shopInfo) {
			return { ...shopInfo, products };
		}
	} catch (error) {
		return { error: error.message };
	}

	return null;
}

async function getAppInstallations(session) {
	if (!session.accessToken || !session.shop) {
		return null;
	}

	try {
		const apiVersion = '2025-01';
		const graphqlUrl = `https://${session.shop}/admin/api/${apiVersion}/graphql.json`;

		const response = await fetch(graphqlUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': session.accessToken,
			},
			body: JSON.stringify({
				query: APP_INSTALLATIONS_QUERY,
			}),
		});

		if (response.ok) {
			const json = await response.json();
			if (json.errors) {
				return { error: `GraphQL errors: ${JSON.stringify(json.errors)}` };
			}
			if (json.data && json.data.appInstallations) {
				const installations = json.data.appInstallations.edges.map(edge => edge.node);
				return installations.length > 0 ? installations : [];
			}
			return [];
		} else {
			const errorText = await response.text();
			return { error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
		}
	} catch (error) {
		return { error: error.message };
	}
}

async function main() {
	console.log('🔍 Verifying Credentials, Installs, and Shop Information\n');
	console.log('='.repeat(80));

	// Get all credentials
	const credentials = await prisma['shopCredential'].findMany({
		where: { status: 'ACTIVE' },
		orderBy: { appHandle: 'asc' },
		select: {
			id: true,
			shopDomain: true,
			appHandle: true,
			apiKey: true,
			appUrl: true,
			scopes: true,
		},
	});

	console.log(`\n📋 Found ${credentials.length} active credential(s):\n`);

	for (const cred of credentials) {
		console.log(`  ${cred.appHandle}:`);
		console.log(`    ID: ${cred.id}`);
		console.log(`    API Key: ${cred.apiKey.substring(0, 8)}...${cred.apiKey.substring(cred.apiKey.length - 4)}`);
		console.log(`    Stored Shop Domain: ${cred.shopDomain}`);
		console.log(`    App URL: ${cred.appUrl}`);
		console.log(`    Scopes: ${cred.scopes.join(', ')}`);
	}

	// Get all sessions
	const allSessionsRaw = await prisma.session.findMany({
		orderBy: { id: 'desc' },
		select: {
			id: true,
			shop: true,
			shopId: true,
			accessToken: true,
			isOnline: true,
			expires: true,
		},
	});

	// Filter sessions with access tokens
	const allSessions = allSessionsRaw.filter(s => s.accessToken);

	console.log(`\n\n📦 Found ${allSessions.length} active session(s) with access tokens:\n`);

	// Group sessions by shopId (linked credential)
	const sessionsByCredential = new Map();
	const unlinkedSessions = [];

	for (const session of allSessions) {
		if (session.shopId) {
			if (!sessionsByCredential.has(session.shopId)) {
				sessionsByCredential.set(session.shopId, []);
			}
			sessionsByCredential.get(session.shopId).push(session);
		} else {
			unlinkedSessions.push(session);
		}
	}

	console.log(`  Linked sessions: ${allSessions.length - unlinkedSessions.length}`);
	console.log(`  Unlinked sessions: ${unlinkedSessions.length}\n`);

	// For each credential, show its sessions and shop info
	console.log('\n' + '='.repeat(80));
	console.log('🔗 Credential → Session → Shop Mapping:\n');

	const credentialToShops = new Map();
	const shopToCredentials = new Map();
	const sessionToCredentialSuggestions = new Map();

	for (const cred of credentials) {
		const linkedSessions = sessionsByCredential.get(cred.id) || [];
		const shops = new Set();

		console.log(`\n${cred.appHandle} (${cred.shopDomain}):`);
		console.log(`  API Key: ${cred.apiKey.substring(0, 12)}...`);

		if (linkedSessions.length === 0) {
			console.log(`  ⚠️  No linked sessions found`);
		} else {
			console.log(`  📦 ${linkedSessions.length} linked session(s):`);

			for (const session of linkedSessions) {
				const shopInfo = await getShopInfoFromSession(session);

				if (shopInfo && !shopInfo.error) {
					const shopDomain = shopInfo.myshopifyDomain || session.shop;
					shops.add(shopDomain);

					console.log(`    Session ${session.id.substring(0, 8)}...:`);
					console.log(`      Shop Name: ${shopInfo.name}`);
					console.log(`      Shop Domain: ${shopInfo.myshopifyDomain}`);
					console.log(`      Configured Domain: ${shopInfo.primaryDomain?.host || 'Not configured'}`);
					console.log(`      Plan: ${shopInfo.plan?.displayName || 'N/A'}`);

					// Show products to verify installation works
					if (shopInfo.products && shopInfo.products.length > 0) {
						console.log(`      ✅ Installation Verified: ${shopInfo.products.length} product(s) found`);
						console.log(
							`      Sample Products: ${shopInfo.products
								.slice(0, 3)
								.map(p => p.title)
								.join(', ')}`,
						);
					} else {
						console.log(`      ⚠️  No products found (may indicate installation issue)`);
					}

					if (shopInfo.myshopifyDomain !== cred.shopDomain) {
						console.log(
							`      ⚠️  MISMATCH: Credential has "${cred.shopDomain}" but API says "${shopInfo.myshopifyDomain}"`,
						);
					}

					// Track shop to credential mapping
					if (!shopToCredentials.has(shopDomain)) {
						shopToCredentials.set(shopDomain, []);
					}
					shopToCredentials.get(shopDomain).push({
						credential: cred.appHandle,
						sessionId: session.id,
						match: shopInfo.myshopifyDomain === cred.shopDomain,
					});
				} else if (shopInfo && shopInfo.error) {
					console.log(`    Session ${session.id.substring(0, 8)}...: ❌ Error: ${shopInfo.error}`);
				} else {
					console.log(`    Session ${session.id.substring(0, 8)}...: ⚠️  Could not fetch shop info`);
				}
			}

			credentialToShops.set(cred.appHandle, Array.from(shops));
		}

		// Check unlinked sessions that might belong to this credential
		// Match by shop domain
		const potentialSessions = [];
		for (const session of unlinkedSessions) {
			const shopInfo = await getShopInfoFromSession(session);
			if (shopInfo && !shopInfo.error) {
				const shopDomain = shopInfo.myshopifyDomain || session.shop;
				// Check if shop domain matches credential's expected domain
				if (shopDomain.toLowerCase() === cred.shopDomain.toLowerCase()) {
					potentialSessions.push({ session, shopInfo });
				}
			}
		}

		if (potentialSessions.length > 0) {
			console.log(`  🔍 ${potentialSessions.length} potential unlinked session(s) (by shop domain match):`);
			for (const { session, shopInfo } of potentialSessions) {
				const shopDomain = shopInfo.myshopifyDomain || session.shop;
				console.log(`    Session ${session.id.substring(0, 8)}...: ${shopDomain} (${shopInfo.name})`);
				console.log(`      Configured Domain: ${shopInfo.primaryDomain?.host || 'Not configured'}`);
				console.log(`      ⚠️  This session is not linked (shopId is null)`);

				// Show products to verify installation works
				if (shopInfo.products && shopInfo.products.length > 0) {
					console.log(`      ✅ Installation Verified: ${shopInfo.products.length} product(s) found`);
					console.log(
						`      Sample Products: ${shopInfo.products
							.slice(0, 3)
							.map(p => p.title)
							.join(', ')}`,
					);
				} else {
					console.log(`      ⚠️  No products found (may indicate installation issue)`);
				}

				console.log(`      💡 SUGGESTION: Link this session to ${cred.appHandle}`);

				// Track suggestion
				if (!sessionToCredentialSuggestions.has(session.id)) {
					sessionToCredentialSuggestions.set(session.id, []);
				}
				sessionToCredentialSuggestions.get(session.id).push({
					credential: cred.appHandle,
					credentialId: cred.id,
					shopDomain: shopDomain,
					confidence: 'shop-domain-match',
				});
			}
		}
	}

	// Show unlinked sessions
	if (unlinkedSessions.length > 0) {
		console.log('\n' + '='.repeat(80));
		console.log('🔍 Unlinked Sessions (shopId is null):\n');

		for (const session of unlinkedSessions) {
			const shopInfo = await getShopInfoFromSession(session);
			if (shopInfo && !shopInfo.error) {
				console.log(`  Session ${session.id.substring(0, 8)}...:`);
				console.log(`    Shop Name: ${shopInfo.name}`);
				console.log(`    Shop Domain: ${shopInfo.myshopifyDomain}`);
				console.log(`    Configured Domain: ${shopInfo.primaryDomain?.host || 'Not configured'}`);
				console.log(`    Plan: ${shopInfo.plan?.displayName || 'N/A'}`);

				// Show products to verify installation works
				if (shopInfo.products && shopInfo.products.length > 0) {
					console.log(`    ✅ Installation Verified: ${shopInfo.products.length} product(s) found`);
					console.log(
						`    Sample Products: ${shopInfo.products
							.slice(0, 3)
							.map(p => p.title)
							.join(', ')}`,
					);
				} else {
					console.log(`    ⚠️  No products found (may indicate installation issue)`);
				}

				console.log(`    ⚠️  Not linked to any credential`);
			} else if (shopInfo && shopInfo.error) {
				console.log(
					`  Session ${session.id.substring(0, 8)}...: ❌ Error fetching shop info: ${shopInfo.error}`,
				);
			} else {
				console.log(`  Session ${session.id.substring(0, 8)}...: ⚠️  Could not fetch shop info`);
			}
		}
	}

	// Show shop to credential mapping summary
	console.log('\n' + '='.repeat(80));
	console.log('📊 Shop → Credential Mapping Summary:\n');

	const shopMapping = Array.from(shopToCredentials.entries()).sort((a, b) => a[0].localeCompare(b[0]));

	for (const [shopDomain, creds] of shopMapping) {
		console.log(`  ${shopDomain}:`);
		for (const cred of creds) {
			const status = cred.match ? '✅' : '⚠️';
			console.log(`    ${status} ${cred.credential} (session: ${cred.sessionId.substring(0, 8)}...)`);
		}
		if (creds.length > 1) {
			console.log(`    ⚠️  CONFLICT: Multiple credentials point to this shop!`);
		}
	}

	// Show all app installations (based on sessions - each session represents an installation)
	console.log('\n' + '='.repeat(80));
	console.log('📱 All App Installations:\n');

	const allInstalls = [];
	const credentialApiKeys = new Map(credentials.map(c => [c.apiKey, c]));

	// Each session represents an app installation
	for (const session of allSessions) {
		const shopInfo = await getShopInfoFromSession(session);
		if (shopInfo && !shopInfo.error) {
			// Find which credential this session belongs to
			let matchingCredential = null;
			if (session.shopId) {
				matchingCredential = credentials.find(c => c.id === session.shopId);
			}

			// If not linked, try to match by shop domain
			if (!matchingCredential) {
				matchingCredential = credentials.find(
					c => c.shopDomain.toLowerCase() === shopInfo.myshopifyDomain.toLowerCase(),
				);
			}

			allInstalls.push({
				shop: shopInfo.myshopifyDomain,
				shopName: shopInfo.name,
				configuredDomain: shopInfo.primaryDomain?.host,
				credential: matchingCredential?.appHandle || 'Unknown',
				apiKey: matchingCredential?.apiKey || 'Unknown',
				sessionId: session.id,
				isLinked: !!session.shopId,
				products: shopInfo.products || [],
			});
		}
	}

	if (allInstalls.length === 0) {
		console.log('  ⚠️  No app installations found\n');
	} else {
		console.log(`  Found ${allInstalls.length} installation(s):\n`);

		// Group by credential
		const installsByCredential = new Map();
		for (const install of allInstalls) {
			if (!installsByCredential.has(install.credential)) {
				installsByCredential.set(install.credential, []);
			}
			installsByCredential.get(install.credential).push(install);
		}

		// Display grouped by credential
		for (const [credential, installs] of installsByCredential.entries()) {
			console.log(`  ${credential}:`);
			for (const install of installs) {
				const linkStatus = install.isLinked ? '✅' : '⚠️';
				console.log(`    ${linkStatus} Shop: ${install.shopName} (${install.shop})`);
				console.log(`      Configured Domain: ${install.configuredDomain || 'Not configured'}`);
				console.log(
					`      API Key: ${install.apiKey !== 'Unknown' ? install.apiKey.substring(0, 12) + '...' : 'Unknown'}`,
				);
				console.log(`      Session ID: ${install.sessionId.substring(0, 8)}...`);
				console.log(`      Linked: ${install.isLinked ? 'Yes' : 'No (shopId is null)'}`);

				if (install.products && install.products.length > 0) {
					console.log(`      ✅ Installation Verified: ${install.products.length} product(s) accessible`);
					console.log(
						`      Sample Products: ${install.products
							.slice(0, 3)
							.map(p => p.title)
							.join(', ')}`,
					);
				} else {
					console.log(`      ⚠️  No products found (may indicate installation issue)`);
				}

				console.log('');
			}
		}

		// Also show a simple list format
		console.log('\n  📋 Quick List:\n');
		for (const install of allInstalls) {
			const linkStatus = install.isLinked ? '✅' : '⚠️';
			const productStatus = install.products && install.products.length > 0 ? '✅' : '⚠️';
			console.log(
				`    ${linkStatus}${productStatus} ${install.shopName} (${install.shop}) → ${install.credential}`,
			);
		}
	}

	// Summary statistics
	console.log('\n' + '='.repeat(80));
	console.log('📈 Summary Statistics:\n');

	const totalShops = new Set();
	for (const shops of credentialToShops.values()) {
		shops.forEach(shop => totalShops.add(shop));
	}

	console.log(`  Total Credentials: ${credentials.length}`);
	console.log(`  Total Sessions: ${allSessions.length}`);
	console.log(`  Linked Sessions: ${allSessions.length - unlinkedSessions.length}`);
	console.log(`  Unlinked Sessions: ${unlinkedSessions.length}`);
	console.log(`  Unique Shops Found: ${totalShops.size}`);
	console.log(`  Total App Installations: ${allInstalls.length}`);

	const mismatches = [];
	for (const cred of credentials) {
		const shops = credentialToShops.get(cred.appHandle) || [];
		for (const shop of shops) {
			if (shop !== cred.shopDomain) {
				mismatches.push({ credential: cred.appHandle, stored: cred.shopDomain, actual: shop });
			}
		}
	}

	if (mismatches.length > 0) {
		console.log(`\n  ⚠️  Shop Domain Mismatches: ${mismatches.length}`);
		mismatches.forEach(m => {
			console.log(`    ${m.credential}: stored "${m.stored}" but API says "${m.actual}"`);
		});
	} else {
		console.log(`\n  ✅ No shop domain mismatches found`);
	}

	const conflicts = Array.from(shopToCredentials.entries()).filter(([_, creds]) => creds.length > 1);
	if (conflicts.length > 0) {
		console.log(`\n  ⚠️  Shop Domain Conflicts: ${conflicts.length}`);
		conflicts.forEach(([shop, creds]) => {
			console.log(`    ${shop}: ${creds.map(c => c.credential).join(', ')}`);
		});
	} else {
		console.log(`\n  ✅ No shop domain conflicts found`);
	}

	console.log('\n' + '='.repeat(80));

	// Show linking suggestions
	if (sessionToCredentialSuggestions.size > 0) {
		console.log('\n💡 Linking Suggestions:\n');
		console.log('The following sessions should be linked to credentials:');
		console.log('\nTo link them, run these SQL commands (or use Prisma):\n');

		for (const [sessionId, suggestions] of sessionToCredentialSuggestions.entries()) {
			const session = allSessions.find(s => s.id === sessionId);
			if (session && suggestions.length > 0) {
				const suggestion = suggestions[0]; // Use first suggestion
				console.log(
					`-- Link session ${sessionId.substring(0, 8)}... (${session.shop}) to ${suggestion.credential}`,
				);
				console.log(
					`UPDATE "Session" SET "shopId" = '${suggestion.credentialId}' WHERE "id" = '${sessionId}';`,
				);
				console.log('');
			}
		}

		console.log('Or use this script to auto-link: bun scripts/link-sessions.mjs');
	}

	console.log('\n' + '='.repeat(80));
	console.log('\n📝 Next Steps:');
	console.log('1. Check Shopify Admin Dashboard to verify which API keys belong to which shops');
	console.log('2. Compare API keys in this output with the ones in Shopify Admin');
	console.log('3. If sessions are incorrectly linked, update the shopDomain in credentials');
	console.log('4. Link sessions to credentials using the suggestions above');
	console.log('\n' + '='.repeat(80));
}

main()
	.catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
