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

describe('db.server - Multitenant shopId resolution', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		forgetShopId('test-shop.myshopify.com');
		forgetShopId('other-shop.myshopify.com');
		forgetShopId('new-shop.myshopify.com');
		forgetShopId('cache-test.myshopify.com');
		forgetShopId('nonexistent-shop.myshopify.com');
		forgetShopId('shop1.myshopify.com');
		forgetShopId('shop2.myshopify.com');
		forgetShopId('concurrent-shop.myshopify.com');
		mockShopCredential.findUnique.mockResolvedValue(null);
	});

	describe('rememberShopId and forgetShopId', () => {
		it('should cache and retrieve shopId', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-123';
			rememberShopId(shop, shopId);

			// Act
			const result = await lookupShopId(shop);

			// Assert
			expect(result).toBe(shopId);
		});

		it('should normalize shop domain to lowercase', async () => {
			// Arrange
			const shop = 'Test-Shop.MyShopify.com';
			const shopId = 'shop-id-normalized';
			rememberShopId(shop, shopId);

			// Act
			const result = await lookupShopId('test-shop.myshopify.com');

			// Assert
			expect(result).toBe(shopId);
		});

		it('should remove shopId from cache', async () => {
			// Arrange
			const shop = 'test-shop.myshopify.com';
			const shopId = 'shop-id-to-forget';
			rememberShopId(shop, shopId);

			// Act
			forgetShopId(shop);
			const result = await lookupShopId(shop);

			// Assert
			expect(result).toBeNull();
		});

		it('should handle null shop gracefully', () => {
			// Arrange & Act & Assert
			expect(() => forgetShopId(null)).not.toThrow();
		});
	});

	describe('lookupShopId - database fallback', () => {
		it('should query database when cache misses', async () => {
			// Arrange
			const shop = 'new-shop.myshopify.com';
			const shopId = 'shop-id-from-db';
			mockShopCredential.findUnique.mockResolvedValue({ id: shopId });

			// Act
			const result = await lookupShopId(shop);

			// Assert
			expect(mockShopCredential.findUnique).toHaveBeenCalledWith({
				where: { shopDomain: shop },
				select: { id: true },
			});
			expect(result).toBe(shopId);
		});

		it('should cache shopId after database lookup', async () => {
			// Arrange
			const shop = 'cache-test.myshopify.com';
			const shopId = 'shop-id-cached';
			mockShopCredential.findUnique.mockResolvedValue({ id: shopId });

			// Act - first lookup (cache miss)
			const result1 = await lookupShopId(shop);
			// Clear mock call count but keep resolved value
			mockShopCredential.findUnique.mockClear();
			// Second lookup (should use cache)
			const result2 = await lookupShopId(shop);

			// Assert
			expect(mockShopCredential.findUnique).not.toHaveBeenCalled();
			expect(result1).toBe(shopId);
			expect(result2).toBe(shopId);
		});

		it('should return null when shop not found in database', async () => {
			// Arrange
			const shop = 'nonexistent-shop.myshopify.com';
			mockShopCredential.findUnique.mockResolvedValue(null);

			// Act
			const result = await lookupShopId(shop);

			// Assert
			expect(result).toBeNull();
			expect(mockShopCredential.findUnique).toHaveBeenCalledWith({
				where: { shopDomain: shop },
				select: { id: true },
			});
		});
	});

	describe('test isolation - multiple shops', () => {
		it('should isolate cache between different shops', async () => {
			// Arrange
			const shop1 = 'shop1.myshopify.com';
			const shopId1 = 'shop-id-1';
			const shop2 = 'shop2.myshopify.com';
			const shopId2 = 'shop-id-2';

			rememberShopId(shop1, shopId1);
			rememberShopId(shop2, shopId2);

			// Act
			const result1 = await lookupShopId(shop1);
			const result2 = await lookupShopId(shop2);

			// Assert
			expect(result1).toBe(shopId1);
			expect(result2).toBe(shopId2);
		});

		it('should handle concurrent lookups for same shop', async () => {
			// Arrange
			const shop = 'concurrent-shop.myshopify.com';
			const shopId = 'shop-id-concurrent';
			rememberShopId(shop, shopId);

			// Act - simulate concurrent lookups
			const results = await Promise.all([
				lookupShopId(shop),
				lookupShopId(shop),
				lookupShopId(shop),
			]);

			// Assert
			results.forEach((result) => {
				expect(result).toBe(shopId);
			});
		});
	});

	describe('edge cases', () => {
		it('should handle empty string shop', async () => {
			// Arrange & Act
			const result = await lookupShopId('');

			// Assert
			expect(result).toBeNull();
		});

		it('should handle whitespace-only shop', async () => {
			// Arrange & Act
			const result = await lookupShopId('   ');

			// Assert
			expect(result).toBeNull();
		});

		it('should normalize shop with mixed case and whitespace', async () => {
			// Arrange
			const shop = '  Test-Shop.MyShopify.com  ';
			const shopId = 'shop-id-normalized';
			rememberShopId(shop, shopId);

			// Act
			const result = await lookupShopId('test-shop.myshopify.com');

			// Assert
			expect(result).toBe(shopId);
		});

		it('should handle undefined shop', async () => {
			// Arrange & Act
			const result = await lookupShopId(undefined as any);

			// Assert
			expect(result).toBeNull();
		});
	});
});
