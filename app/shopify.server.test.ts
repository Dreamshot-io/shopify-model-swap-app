import { describe, expect, it } from '@jest/globals';

import { __testing__ } from './shopify.server';

const { sanitizeShopInput, normalizeShopDomain } = __testing__;

describe('shopify.server helpers', () => {
	it('sanitizes full Shopify URLs', () => {
		expect(sanitizeShopInput('https://example-shop.myshopify.com/admin')).toBe('example-shop.myshopify.com');
	});

	it('appends Shopify domain suffix when missing', () => {
		expect(sanitizeShopInput('coolstore')).toBe('coolstore.myshopify.com');
	});

	it('rejects non-Shopify domains', () => {
		expect(sanitizeShopInput('malicious.example.com')).toBeNull();
	});

	it('normalizes uppercase shops', () => {
		expect(normalizeShopDomain('My-Shop.MyShopify.com')).toBe('my-shop.myshopify.com');
	});
});
