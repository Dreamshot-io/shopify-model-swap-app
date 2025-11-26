import "@shopify/shopify-app-remix/adapters/vercel";
import {
	ApiVersion,
	AppDistribution,
	LoginErrorType,
	shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

import prisma from "./db.server";
import { findShopCredential, requireShopCredential } from "./services/shops.server";

type ShopCredentialType = {
	id: string;
	shopDomain: string;
	apiKey: string;
	apiSecret: string;
	appHandle: string;
	appUrl: string;
	apiVersion: string;
	scopes: string[];
	distribution: string | null;
	customDomain: string | null;
	redirectUrls: string[];
	metadata: any;
	status: string;
	mode?: string;
	createdAt: Date;
	updatedAt: Date;
};

const sessionStorage = new PrismaSessionStorage(prisma);
const DEFAULT_API_VERSION = ApiVersion.January25;

const PUBLIC_APP_CONFIG = {
	apiKey: process.env.SHOPIFY_PUBLIC_API_KEY,
	apiSecret: process.env.SHOPIFY_PUBLIC_API_SECRET,
	appUrl: process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io',
	scopes: process.env.SCOPES?.split(',') || [],
	distribution: 'AppStore',
	appHandle: 'dreamshot-model-swap',
} as const;

function isPublicAppConfigured() {
	return !!(PUBLIC_APP_CONFIG.apiKey && PUBLIC_APP_CONFIG.apiSecret);
}

function createPublicCredential(shopDomain: string): ShopCredentialType {
	if (!isPublicAppConfigured()) {
		throw new Error('Public app credentials not configured');
	}

	const normalized = normalizeShopDomain(shopDomain);
	if (!normalized) {
		throw new Error('Invalid shop domain');
	}

	return {
		id: `public:${normalized}`,
		shopDomain: normalized,
		apiKey: PUBLIC_APP_CONFIG.apiKey!,
		apiSecret: PUBLIC_APP_CONFIG.apiSecret!,
		appHandle: PUBLIC_APP_CONFIG.appHandle,
		appUrl: PUBLIC_APP_CONFIG.appUrl,
		apiVersion: DEFAULT_API_VERSION,
		scopes: PUBLIC_APP_CONFIG.scopes,
		distribution: PUBLIC_APP_CONFIG.distribution,
		customDomain: null,
		redirectUrls: [],
		metadata: { mode: 'PUBLIC' },
		status: 'ACTIVE',
		mode: 'PUBLIC',
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

type ShopifyAppInstance = ReturnType<typeof shopifyApp>;

const appCache = new Map<string, ShopifyAppInstance>();

const normalizeShopDomain = (value?: string | null) => value?.trim().toLowerCase() ?? null;

const coerceApiVersion = (value?: string | null) => {
	if (!value) {
		return DEFAULT_API_VERSION;
	}

	return (ApiVersion as Record<string, ApiVersion>)[value as keyof typeof ApiVersion] ?? DEFAULT_API_VERSION;
};

const coerceDistribution = (value?: string | null) => {
	if (!value) {
		return AppDistribution.AppStore;
	}

	return (
		(AppDistribution as Record<string, AppDistribution>)[value as keyof typeof AppDistribution] ??
		AppDistribution.AppStore
	);
};

const decodeBase64Url = (value: string) => {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padLength = (4 - (normalized.length % 4)) % 4;
	return Buffer.from(normalized.padEnd(normalized.length + padLength, "="), "base64").toString("utf-8");
};

const decodeJwtPayload = (token: string) => {
	const [, payload] = token.split(".");
	if (!payload) {
		return null;
	}

	try {
		return JSON.parse(decodeBase64Url(payload));
	} catch {
		return null;
	}
};

const getSessionTokenFromRequest = (request: Request) => {
	const header = request.headers.get("Authorization");
	if (header?.startsWith("Bearer ")) {
		return header.slice("Bearer ".length);
	}

	const url = new URL(request.url);
	return url.searchParams.get("session_token");
};

const extractClientId = (request: Request) => {
	const token = getSessionTokenFromRequest(request);
	if (token) {
		const payload = decodeJwtPayload(token);
		if (payload?.aud) {
			return Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
		}
	}

	const headerClientId = request.headers.get("X-Shopify-Client-Id");
	if (headerClientId) {
		return headerClientId;
	}

	const url = new URL(request.url);
	const queryClientId = url.searchParams.get("client_id");
	if (queryClientId) {
		return queryClientId;
	}

	return null;
};

const extractShopFromHostParam = (hostParam: string | null) => {
	if (!hostParam) {
		return null;
	}

	try {
		const decoded = decodeBase64Url(hostParam);
		const [shop] = decoded.split("/admin");
		return normalizeShopDomain(shop);
	} catch {
		return null;
	}
};

const extractShopFromSessionToken = (request: Request) => {
	const token = getSessionTokenFromRequest(request);
	if (!token) {
		return null;
	}

	const payload = decodeJwtPayload(token);
	if (!payload?.dest) {
		return null;
	}

	try {
		const url = new URL(payload.dest);
		return normalizeShopDomain(url.hostname);
	} catch {
		return null;
	}
};

const extractShopFromOrigin = (origin: string | null) => {
	if (!origin) {
		return null;
	}

	try {
		const originUrl = new URL(origin);
		const hostname = originUrl.hostname;

		if (hostname.endsWith(".myshopify.com")) {
			return normalizeShopDomain(hostname);
		}

		if (hostname.includes("myshopify.com")) {
			const parts = hostname.split(".");
			const shopPart = parts[0];
			return normalizeShopDomain(`${shopPart}.myshopify.com`);
		}
	} catch {
		// ignore invalid origin
	}

	return null;
};

const SHOP_COOKIE_NAME = 'shopify_shop_domain';

const extractShopFromCookie = (request: Request) => {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) {
		return null;
	}

	const cookies = cookieHeader.split(';').map(c => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split('=');
		if (name === SHOP_COOKIE_NAME && value) {
			return normalizeShopDomain(decodeURIComponent(value));
		}
	}
	return null;
};

export const createShopCookie = (shop: string) => {
	const encoded = encodeURIComponent(shop);
	// HttpOnly=false so App Bridge can potentially read it; Secure in production
	const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
	return `${SHOP_COOKIE_NAME}=${encoded}; Path=/; SameSite=Lax; Max-Age=86400${secure}`;
};

const extractShopDomain = (request: Request) => {
	const headerShop = request.headers.get("X-Shopify-Shop-Domain");
	if (headerShop) {
		return normalizeShopDomain(headerShop);
	}

	const url = new URL(request.url);
	const queryShop = url.searchParams.get("shop");
	if (queryShop) {
		return normalizeShopDomain(queryShop);
	}

	const hostShop = extractShopFromHostParam(url.searchParams.get("host"));
	if (hostShop) {
		return hostShop;
	}

	const originShop = extractShopFromOrigin(request.headers.get("Origin"));
	if (originShop) {
		return originShop;
	}

	const referer = request.headers.get("Referer");
	if (referer) {
		try {
			const refererUrl = new URL(referer);
			const refererShop = refererUrl.searchParams.get("shop");
			if (refererShop) {
				return normalizeShopDomain(refererShop);
			}

			const refererHostname = refererUrl.hostname;
			if (refererHostname.endsWith(".myshopify.com")) {
				return normalizeShopDomain(refererHostname);
			}
		} catch {
			// ignore invalid referer
		}
	}

	const tokenShop = extractShopFromSessionToken(request);
	if (tokenShop) {
		return tokenShop;
	}

	// Fallback: Try to extract from cookie (useful for HMR reloads)
	return extractShopFromCookie(request);
};

const resolveCredentialFromRequest = async (request: Request) => {
	const clientId = extractClientId(request);
	const shop = extractShopDomain(request);
	
	// Attempt 1: Find by clientId in database
	if (clientId) {
		const credential = await findShopCredential({ clientId });
		if (credential) {
			return credential;
		}

		// If clientId matches public app and no DB record exists, create virtual credential
		if (isPublicAppConfigured() && clientId === PUBLIC_APP_CONFIG.apiKey) {
			if (!shop) {
				throw new Response("Shop domain required for public app installation", { status: 400 });
			}
			return createPublicCredential(shop);
		}
		
		// clientId provided but doesn't match any credential or public app
		console.error(`[shopify.server] Credential mismatch - clientId: ${clientId}, shop: ${shop}`);
		throw new Response(
			`App credentials mismatch. The app was opened with client_id "${clientId}" but no matching credential was found. Please contact support.`,
			{ status: 401 }
		);
	}

	// Attempt 2: Find by shopDomain in database
	if (shop) {
		const credential = await findShopCredential({ shopDomain: shop });
		if (credential) {
			return credential;
		}

		// If no DB record and public app configured, assume new public installation
		if (isPublicAppConfigured()) {
			return createPublicCredential(shop);
		}

		console.error(`[shopify.server] Shop not found in database: ${shop}`);
		throw new Response(
			`Shop "${shop}" is not registered with this app. Please contact support to set up your account.`,
			{ status: 404 }
		);
	}

	throw new Response("Unable to determine shop context from request. Please try accessing the app from Shopify Admin.", { status: 401 });
};

const extractShopInput = async (request: Request) => {
	const url = new URL(request.url);
	const fromQuery = url.searchParams.get("shop");
	if (fromQuery) {
		return fromQuery;
	}

	if (request.method === "POST") {
		const cloned = request.clone();
		const formData = await cloned.formData();
		const field = formData.get("shop");
		if (typeof field === "string") {
			return field;
		}
	}

	return null;
};

const sanitizeShopInput = (input: string) => {
	const cleaned = input.trim();
	if (!cleaned) {
		return null;
	}

	const withoutProtocol = cleaned.replace(/^https?:\/\//i, "").split("/")[0];
	const candidate = withoutProtocol.includes(".") ? withoutProtocol : `${withoutProtocol}.myshopify.com`;
	const normalized = normalizeShopDomain(candidate);

	if (!normalized || !normalized.endsWith(".myshopify.com")) {
		return null;
	}

	return normalized;
};

// Always use SHOPIFY_APP_URL from env - credential.appUrl is deprecated
const APP_URL = process.env.SHOPIFY_APP_URL || 'https://abtest.dreamshot.io';

const getShopifyAppForCredential = async (credential: ShopCredentialType) => {
	const cached = appCache.get(credential.id);
	if (cached) {
		return cached;
	}

	const app = shopifyApp({
		apiKey: credential.apiKey,
		apiSecretKey: credential.apiSecret,
		apiVersion: coerceApiVersion(credential.apiVersion),
		scopes: credential.scopes,
		appUrl: APP_URL,
		authPathPrefix: "/auth",
		sessionStorage,
		distribution: coerceDistribution(credential.distribution),
		future: {
			removeRest: true,
		},
		...(credential.customDomain ? { customShopDomains: [credential.customDomain] } : {}),
	});

	appCache.set(credential.id, app);
	return app;
};

const resolveAppForRequest = async (request: Request) => {
	const credential = await resolveCredentialFromRequest(request);
	const app = await getShopifyAppForCredential(credential);
	return { app, credential };
};

export const getShopifyContextByShopDomain = async (shopDomain: string) => {
	const normalized = normalizeShopDomain(shopDomain);
	if (!normalized) {
		throw new Error("Invalid shop domain");
	}

	const credential = await requireShopCredential({ shopDomain: normalized });
	const app = await getShopifyAppForCredential(credential);
	return { app, credential };
};

const linkSessionToShopId = async (sessionId: string | undefined, shopId: string) => {
	if (!sessionId) {
		return;
	}

	try {
		await prisma.session.update({
			where: { id: sessionId },
			data: { shopId },
		});
	} catch (error) {
		console.error('[shopify.server] Failed to link session to shopId', error);
	}
};

const decorateResult = <T extends object>(result: T, credential: ShopCredentialType) => ({
	...result,
	shopCredential: credential,
	shopDomain: credential.shopDomain,
	shopId: credential.id,
});

async function persistPublicInstallation(shopDomain: string, sessionData: any) {
	const existing = await findShopCredential({ shopDomain });
	if (existing) {
		return existing;
	}

	console.log(`[shopify.server] Registering new public installation: ${shopDomain}`);
	
	const { createShopCredential } = await import('./services/shops.server');
	
	return createShopCredential({
		shopDomain,
		apiKey: PUBLIC_APP_CONFIG.apiKey!,
		apiSecret: PUBLIC_APP_CONFIG.apiSecret!,
		appHandle: PUBLIC_APP_CONFIG.appHandle,
		appUrl: PUBLIC_APP_CONFIG.appUrl,
		scopes: PUBLIC_APP_CONFIG.scopes,
		distribution: PUBLIC_APP_CONFIG.distribution,
		metadata: { 
			mode: 'PUBLIC',
			installedAt: new Date().toISOString(),
			installedVia: 'oauth',
			sessionId: sessionData?.id,
		},
	});
}

export const authenticate = {
	admin: async (request: Request) => {
		const url = new URL(request.url);
		console.log('[shopify.server] authenticate.admin called:', {
			url: url.pathname + url.search,
			shop: url.searchParams.get('shop'),
			host: url.searchParams.get('host'),
			hasSessionToken: !!request.headers.get('Authorization'),
			method: request.method,
		});
		
		const { app, credential } = await resolveAppForRequest(request);
		console.log('[shopify.server] Resolved credential:', credential.shopDomain, credential.apiKey.slice(0, 8) + '...');
		
		const context = await app.authenticate.admin(request);
		
		// If virtual public credential, persist to database
		if (credential.id.startsWith('public:')) {
			const persisted = await persistPublicInstallation(credential.shopDomain, context.session);
			await linkSessionToShopId(context.session?.id, persisted.id);
			return decorateResult(context, persisted);
		}
		
		await linkSessionToShopId(context.session?.id, credential.id);
		return decorateResult(context, credential);
	},
	public: {
		appProxy: async (request: Request) => {
			const { app, credential } = await resolveAppForRequest(request);
			const context = await app.authenticate.public.appProxy(request);
			return decorateResult(context, credential);
		},
	},
	webhook: async (request: Request) => {
		const { app, credential } = await resolveAppForRequest(request);
		const context = await app.authenticate.webhook(request);
		return decorateResult(context, credential);
	},
};

export const unauthenticated = {
	admin: async (shop: string) => {
		const credential = await requireShopCredential({ shopDomain: shop });
		const app = await getShopifyAppForCredential(credential);
		return app.unauthenticated.admin(shop);
	},
	storefront: async (shop: string) => {
		const credential = await requireShopCredential({ shopDomain: shop });
		const app = await getShopifyAppForCredential(credential);
		return app.unauthenticated.storefront(shop);
	},
};

export const login = async (request: Request) => {
	const url = new URL(request.url);
	if (request.method === "GET" && !url.searchParams.get("shop")) {
		return {};
	}

	const shopInput = await extractShopInput(request);
	if (!shopInput) {
		return { shop: LoginErrorType.MissingShop };
	}

	const sanitizedShop = sanitizeShopInput(shopInput);
	if (!sanitizedShop) {
		return { shop: LoginErrorType.InvalidShop };
	}

	// Try to find existing credential (private app)
	let credential = await findShopCredential({ shopDomain: sanitizedShop });
	
	// If not found, use public app credentials (if configured)
	if (!credential && isPublicAppConfigured()) {
		console.log('[shopify.server] No credential found for shop, using public app credentials');
		credential = createPublicCredential(sanitizedShop);
	}
	
	// If still no credential, return error
	if (!credential) {
		return { shop: LoginErrorType.InvalidShop };
	}

	const app = await getShopifyAppForCredential(credential);
	return app.login(request);
};

export const registerWebhooks = async (
	shopDomain: string,
	params: Parameters<ShopifyAppInstance["registerWebhooks"]>[0],
) => {
	const credential = await requireShopCredential({ shopDomain });
	const app = await getShopifyAppForCredential(credential);
	return app.registerWebhooks(params);
};

export const addDocumentResponseHeaders = async (request: Request, headers: Headers) => {
	try {
		const { app } = await resolveAppForRequest(request);
		app.addDocumentResponseHeaders(request, headers);
	} catch (error) {
		console.warn('[shopify.server] Could not resolve app for document headers:', error instanceof Error ? error.message : error);
	}
};

export const extractShopDomainFromRequest = extractShopDomain;

export { sessionStorage };
export const apiVersion = DEFAULT_API_VERSION;
export const __testing__ = {
	normalizeShopDomain,
	sanitizeShopInput,
	extractClientId,
	extractShopDomain,
	extractShopFromOrigin,
};
