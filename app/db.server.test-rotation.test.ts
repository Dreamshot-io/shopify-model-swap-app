import { describe, it, expect, beforeEach, vi } from 'vitest';

import { rememberShopId, forgetShopId, lookupShopId } from './db.server';

const mockShopCredential = vi.hoisted(() => {
	return {
		findUnique: vi.fn().mockResolvedValue(null),
	};
});

vi.mock('@prisma/client', () => {
	const mockShopCred = mockShopCredential;
	
	const mockExtendedPrisma = {
		shopCredential: mockShopCred,
		aIStudioImage: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			count: vi.fn(),
		},
		metricEvent: {
			create: vi.fn(),
		},
	};
	
	const baseMock = {
		shopCredential: mockShopCred,
		$extends: vi.fn().mockReturnValue(mockExtendedPrisma),
	};
	
	return {
		PrismaClient: vi.fn().mockImplementation(() => baseMock),
	};
});

vi.mock('./services/encryption.server', () => ({
	encrypt: vi.fn((x) => x),
	decrypt: vi.fn((x) => x),
	isEncrypted: vi.fn(() => false),
}));

describe('Test Rotation - db.server tests can run in any order', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		forgetShopId('shop-a.myshopify.com');
		forgetShopId('shop-b.myshopify.com');
		forgetShopId('shop-c.myshopify.com');
		mockShopCredential.findUnique.mockResolvedValue(null);
	});

	it('test 1: should work when run first', async () => {
		const shop = 'shop-a.myshopify.com';
		const shopId = 'id-a';
		rememberShopId(shop, shopId);
		expect(await lookupShopId(shop)).toBe(shopId);
	});

	it('test 2: should work when run second', async () => {
		const shop = 'shop-b.myshopify.com';
		const shopId = 'id-b';
		rememberShopId(shop, shopId);
		expect(await lookupShopId(shop)).toBe(shopId);
	});

	it('test 3: should work when run third', async () => {
		const shop = 'shop-c.myshopify.com';
		const shopId = 'id-c';
		rememberShopId(shop, shopId);
		expect(await lookupShopId(shop)).toBe(shopId);
	});

	it('test 4: should not leak state from previous tests', async () => {
		const shop = 'shop-a.myshopify.com';
		const result = await lookupShopId(shop);
		expect(result).toBeNull();
	});

	it('test 5: concurrent operations should not interfere', async () => {
		const shop1 = 'shop-a.myshopify.com';
		const shopId1 = 'id-a';
		const shop2 = 'shop-b.myshopify.com';
		const shopId2 = 'id-b';

		rememberShopId(shop1, shopId1);
		rememberShopId(shop2, shopId2);

		const results = await Promise.all([
			lookupShopId(shop1),
			lookupShopId(shop2),
			lookupShopId(shop1),
		]);

		expect(results[0]).toBe(shopId1);
		expect(results[1]).toBe(shopId2);
		expect(results[2]).toBe(shopId1);
	});
});
