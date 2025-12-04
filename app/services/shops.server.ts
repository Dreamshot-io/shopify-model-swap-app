import prisma, { forgetShopId, rememberShopId } from '../db.server';
import { encrypt, decrypt, isEncrypted } from './encryption.server';

type ShopCredential = {
	id: string;
	shopDomain: string;
	shopName: string | null;
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
	status: ShopCredentialStatus;
	mode: ShopCredentialMode;
	createdAt: Date;
	updatedAt: Date;
};

type ShopCredentialStatus = 'ACTIVE' | 'DISABLED';
type ShopCredentialMode = 'PUBLIC' | 'PRIVATE';

type ShopLookupInput = { shopDomain: string } | { shopId: string } | { clientId: string };

interface CredentialCacheEntry {
	credential: ShopCredential;
	cachedAt: number;
}

const cache = new Map<string, CredentialCacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

const keyForDomain = (domain: string) => `domain:${domain.toLowerCase()}`;
const keyForId = (id: string) => `id:${id}`;
const keyForClientId = (clientId: string) => `client:${clientId}`;

function isExpired(entry: CredentialCacheEntry | undefined) {
	if (!entry) {
		return true;
	}

	return Date.now() - entry.cachedAt > CACHE_TTL_MS;
}

function decryptCredential(credential: ShopCredential): ShopCredential {
	return {
		...credential,
		apiSecret: isEncrypted(credential.apiSecret) ? decrypt(credential.apiSecret) : credential.apiSecret,
	};
}

function encryptCredentialData(data: {
	apiKey?: string;
	apiSecret?: string;
	[key: string]: any;
}): typeof data {
	const encrypted: typeof data = { ...data };

	if (data.apiSecret && !isEncrypted(data.apiSecret)) {
		encrypted.apiSecret = encrypt(data.apiSecret);
	}

	return encrypted;
}

function cacheCredential(credential: ShopCredential) {
	const decrypted = decryptCredential(credential);
	cache.set(keyForDomain(decrypted.shopDomain), { credential: decrypted, cachedAt: Date.now() });
	cache.set(keyForId(decrypted.id), { credential: decrypted, cachedAt: Date.now() });
	cache.set(keyForClientId(decrypted.apiKey), { credential: decrypted, cachedAt: Date.now() });
	rememberShopId(decrypted.shopDomain, decrypted.id);
	return decrypted;
}

export function invalidateShopCredentialCache(shopIdOrDomain: string) {
	cache.delete(keyForId(shopIdOrDomain));
	cache.delete(keyForDomain(shopIdOrDomain));
	cache.delete(keyForClientId(shopIdOrDomain));
	forgetShopId(shopIdOrDomain);
}

export async function findShopCredential(input: ShopLookupInput) {
	const cacheKey =
		'shopDomain' in input
			? keyForDomain(input.shopDomain)
			: 'shopId' in input
				? keyForId(input.shopId)
				: keyForClientId(input.clientId);

	const cached = cache.get(cacheKey);
	if (cached && !isExpired(cached)) {
		return cached.credential;
	}

	let credential = (await prisma['shopCredential'].findFirst({
		where:
			'shopDomain' in input
				? { shopDomain: input.shopDomain.toLowerCase() }
				: 'shopId' in input
					? { id: input.shopId }
					: { apiKey: input.clientId },
	})) as ShopCredential | null;

	// Fallback: search by customDomain if shopDomain lookup failed
	if (!credential && 'shopDomain' in input) {
		credential = (await prisma['shopCredential'].findFirst({
			where: { customDomain: input.shopDomain.toLowerCase() },
		})) as ShopCredential | null;
	}

	if (!credential) {
		return null;
	}

	return cacheCredential(decryptCredential(credential));
}

export async function requireShopCredential(input: ShopLookupInput) {
	const credential = await findShopCredential(input);
	if (!credential) {
		throw new Response('Shop credential not found', { status: 404 });
	}

	if (credential.status !== 'ACTIVE') {
		throw new Response('Shop credential disabled', { status: 403 });
	}

	return credential;
}

export async function createShopCredential(data: {
	shopDomain: string;
	shopName?: string;
	apiKey: string;
	apiSecret: string;
	appHandle: string;
	appUrl: string;
	apiVersion?: string;
	scopes: string[];
	distribution?: string | null;
	customDomain?: string | null;
	redirectUrls?: string[];
	metadata?: Record<string, unknown>;
	mode?: ShopCredentialMode;
}) {
	const encryptedData = encryptCredentialData({
		shopDomain: data.shopDomain.toLowerCase(),
		shopName: data.shopName ?? null,
		apiKey: data.apiKey,
		apiSecret: data.apiSecret,
		appHandle: data.appHandle,
		appUrl: data.appUrl,
		apiVersion: data.apiVersion ?? 'January25',
		scopes: data.scopes,
		distribution: data.distribution ?? 'AppStore',
		customDomain: data.customDomain ?? null,
		redirectUrls: data.redirectUrls ?? [],
		metadata: data.metadata ?? {},
		mode: data.mode ?? 'PUBLIC',
	});

	const credential = (await prisma['shopCredential'].create({
		data: encryptedData,
	})) as ShopCredential;

	return cacheCredential(credential);
}

export async function updateShopCredential(
	shopId: string,
	data: Partial<
		Pick<
			ShopCredential,
			| 'apiKey'
			| 'apiSecret'
			| 'appHandle'
			| 'appUrl'
			| 'apiVersion'
			| 'scopes'
			| 'distribution'
			| 'customDomain'
			| 'redirectUrls'
			| 'metadata'
			| 'status'
			| 'mode'
		>
	>,
) {
	const encryptedData = encryptCredentialData(data);
	const credential = (await prisma['shopCredential'].update({
		where: { id: shopId },
		data: encryptedData,
	})) as ShopCredential;

	return cacheCredential(credential);
}

export async function setShopCredentialStatus(shopId: string, status: ShopCredentialStatus) {
	const credential = (await prisma['shopCredential'].update({
		where: { id: shopId },
		data: { status },
	})) as ShopCredential;

	cacheCredential(credential);
	return credential;
}

export async function listShopCredentials() {
	const credentials = (await prisma['shopCredential'].findMany({
		orderBy: { createdAt: 'desc' },
	})) as ShopCredential[];

	return credentials.map(decryptCredential);
}

export function getCachedShopCredential(shopIdOrDomain: string) {
	return (
		cache.get(keyForId(shopIdOrDomain))?.credential ?? cache.get(keyForDomain(shopIdOrDomain))?.credential ?? null
	);
}
