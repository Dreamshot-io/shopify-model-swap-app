import { PrismaClient } from "@prisma/client";
import { encrypt, decrypt, isEncrypted } from "./services/encryption.server";

// Reuse Prisma client across serverless invocations to avoid exhausting DB connections
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

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

const prismaBase =
  globalThis.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

const SHOP_AWARE_MODELS = new Set([
  "Session",
  "ABTest",
  "AuditLog",
  "MetricEvent",
  "ProductSuggestionRule",
  "GenerationHistory",
  "AIStudioImage",
]);

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

	const credential = await prismaBase['shopCredential'].findUnique({
		where: { shopDomain: normalized },
		select: { id: true },
	});

  if (!credential) {
    return null;
  }

  shopIdCache.set(normalized, credential.id);
  return credential.id;
}

async function attachShopId(data: unknown) {
  if (!data || typeof data !== "object") {
    return;
  }

  if (Array.isArray(data)) {
    await Promise.all(data.map((entry) => attachShopId(entry)));
    return;
  }

  const candidate = data as { shop?: string; shopId?: string };
  if (candidate.shop && !candidate.shopId) {
    const normalized = normalizeShopDomain(candidate.shop);
    if (normalized) {
      candidate.shop = normalized;
      const shopId = await lookupShopId(normalized);
      if (shopId) {
        candidate.shopId = shopId;
      }
    }
  }
}

// Prisma client extension for transparent encryption/decryption and shopId attachment
const prisma = prismaBase.$extends({
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
					// Decrypt if encrypted, otherwise return as-is (for backward compatibility)
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
});

// In development, preserve the client across HMR; in production, cache for warm lambdas
if (process.env.NODE_ENV !== "production") {
  // Cast needed because $extends() returns a different type than base PrismaClient
  globalThis.prisma = prisma as unknown as PrismaClient;
}

export default prisma;
