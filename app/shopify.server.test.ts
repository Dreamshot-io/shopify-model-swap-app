import { describe, it, expect } from 'vitest';
import { __testing__ } from './shopify.server';

const { sanitizeShopInput, normalizeShopDomain } = __testing__;

describe('shopify.server helpers', () => {
	it('should sanitize full Shopify URLs', () => {
		// Arrange
		const input = 'https://example-shop.myshopify.com/admin';

		// Act
		const result = sanitizeShopInput(input);

		// Assert
		expect(result).toBe('example-shop.myshopify.com');
	});

	it('should append Shopify domain suffix when missing', () => {
		// Arrange
		const input = 'coolstore';

		// Act
		const result = sanitizeShopInput(input);

		// Assert
		expect(result).toBe('coolstore.myshopify.com');
	});

	it('should reject non-Shopify domains', () => {
		// Arrange
		const input = 'malicious.example.com';

		// Act
		const result = sanitizeShopInput(input);

		// Assert
		expect(result).toBeNull();
	});

	it('should normalize uppercase shops', () => {
		// Arrange
		const input = 'My-Shop.MyShopify.com';

		// Act
		const result = normalizeShopDomain(input);

		// Assert
		expect(result).toBe('my-shop.myshopify.com');
	});
});
