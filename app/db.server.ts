import { PrismaClient } from "@prisma/client";

// Reuse Prisma client across serverless invocations to avoid exhausting DB connections
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma =
  globalThis.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// In development, preserve the client across HMR; in production, cache for warm lambdas
if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

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

async function lookupShopId(shop: string) {
  const normalized = normalizeShopDomain(shop);
  if (!normalized) {
    return null;
  }

  const cached = shopIdCache.get(normalized);
  if (cached) {
    return cached;
  }

	const credential = await prisma['shopCredential'].findUnique({
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

type PrismaMiddlewareParams = {
	model?: string;
	action: string;
	args?: {
		data?: unknown;
		create?: unknown;
		update?: unknown;
	};
};

type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<unknown>;

prisma.$use(async (params: PrismaMiddlewareParams, next: PrismaMiddlewareNext) => {
	if (!params.model || params.model === 'ShopCredential' || !SHOP_AWARE_MODELS.has(params.model)) {
		return next(params);
	}

	if (params.action === 'create' || params.action === 'update') {
		await attachShopId(params.args?.data);
	} else if (params.action === 'upsert') {
		await attachShopId(params.args?.create);
		await attachShopId(params.args?.update);
	} else if (params.action === 'createMany') {
		await attachShopId(params.args?.data);
	} else if (params.action === 'updateMany') {
		await attachShopId(params.args?.data);
	}

	return next(params);
});

export default prisma;
