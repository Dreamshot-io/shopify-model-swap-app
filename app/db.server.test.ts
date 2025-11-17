import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@prisma/client', () => {
	const mockShopCredential = {
		findUnique: vi.fn().mockResolvedValue(null),
	};

	const createMockPrismaBase = () => ({
		shopCredential: mockShopCredential,
		$extends: vi.fn().mockImplementation(() => ({
			shopCredential: mockShopCredential,
		})),
	});

	return {
		PrismaClient: vi.fn().mockImplementation(() => createMockPrismaBase()),
	};
});

vi.mock('./services/encryption.server', () => ({
	encrypt: vi.fn((x) => x),
	decrypt: vi.fn((x) => x),
	isEncrypted: vi.fn(() => false),
}));

import { rememberShopId, forgetShopId, lookupShopId } from './db.server';

describe('db.server - Multitenant shopId resolution', () => {
	beforeEach(() => {
		forgetShopId('test-shop.myshopify.com');
		forgetShopId('other-shop.myshopify.com');
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
});
