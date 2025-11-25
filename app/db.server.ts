import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt, isEncrypted } from './services/encryption.server';

// Encrypt apiSecret on write operations
function encryptApiSecret(data: unknown) {
	if (!data || typeof data !== 'object') {
		return;
	}

	const record = data as { apiSecret?: string };
	if (record.apiSecret && !isEncrypted(record.apiSecret)) {
		record.apiSecret = encrypt(record.apiSecret);
	}
}

// Create extended Prisma client with encryption middleware
function createExtendedPrismaClient() {
	const base = new PrismaClient({
		log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
	});

	return base.$extends({
		query: {
			shopCredential: {
				async create({ args, query }) {
					encryptApiSecret(args.data);
					return query(args);
				},
				async update({ args, query }) {
					encryptApiSecret(args.data);
					return query(args);
				},
				async upsert({ args, query }) {
					encryptApiSecret(args.create);
					encryptApiSecret(args.update);
					return query(args);
				},
				async createMany({ args, query }) {
					if (Array.isArray(args.data)) {
						args.data.forEach(encryptApiSecret);
					}
					return query(args);
				},
				async updateMany({ args, query }) {
					encryptApiSecret(args.data);
					return query(args);
				},
			},
		},
		result: {
			shopCredential: {
				apiSecret: {
					needs: { apiSecret: true },
					compute(credential: { apiSecret: string }) {
						if (!credential.apiSecret) {
							return credential.apiSecret;
						}
						if (isEncrypted(credential.apiSecret)) {
							return decrypt(credential.apiSecret);
						}
						return credential.apiSecret;
					},
				},
			},
		},
	}) as unknown as PrismaClient;
}

// Export the type for use in other files
export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

// Reuse Prisma client across serverless invocations to avoid exhausting DB connections
declare global {
	// eslint-disable-next-line no-var
	var prisma: ExtendedPrismaClient | undefined;
}

// Shop ID cache and helpers
const shopIdCache = new Map<string, string>();

const normalizeShopDomain = (shop?: string | null) => shop?.trim().toLowerCase() ?? null;

export function rememberShopId(shop: string, shopId: string) {
	const normalized = normalizeShopDomain(shop);
	if (!normalized) {
		return;
	}
	shopIdCache.set(normalized, shopId);
}

export function forgetShopId(shop: string | null | undefined) {
	const normalized = normalizeShopDomain(shop ?? undefined);
	if (!normalized) {
		return;
	}
	shopIdCache.delete(normalized);
}

export async function lookupShopId(shop: string) {
	const normalized = normalizeShopDomain(shop);
	if (!normalized) {
		return null;
	}

	const cached = shopIdCache.get(normalized);
	if (cached) {
		return cached;
	}

	const credential = await prisma.shopCredential.findUnique({
		where: { shopDomain: normalized },
		select: { id: true },
	});

	if (!credential) {
		return null;
	}

	shopIdCache.set(normalized, credential.id);
	return credential.id;
}

// Create or reuse the prisma client
const prisma = globalThis.prisma ?? createExtendedPrismaClient();

// In development, preserve the client across HMR; in production, cache for warm lambdas
if (process.env.NODE_ENV !== 'production') {
	globalThis.prisma = prisma;
}

export default prisma;
