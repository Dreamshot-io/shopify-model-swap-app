import { describe, expect, test } from '@jest/globals';
import { RotationVariant } from '@prisma/client';
import { mapRotationToAbVariant, normalizeVariantId } from '../track';

describe('normalizeVariantId', () => {
	test('returns null when input is null', () => {
		expect(normalizeVariantId(null)).toBeNull();
	});

	test('passes through gid format unchanged', () => {
		const gid = 'gid://shopify/ProductVariant/123';
		expect(normalizeVariantId(gid)).toBe(gid);
	});

	test('converts numeric id to gid', () => {
		expect(normalizeVariantId('456')).toBe('gid://shopify/ProductVariant/456');
	});
});

describe('mapRotationToAbVariant', () => {
	const slot = {
		variantA: { variant: 'A' as const },
		variantB: { variant: 'B' as const },
	};

	test('maps control rotation to variant A', () => {
		const result = mapRotationToAbVariant(slot, RotationVariant.CONTROL);
		expect(result).toEqual({ code: 'A' });
	});

	test('maps test rotation to variant B', () => {
		const result = mapRotationToAbVariant(slot, RotationVariant.TEST);
		expect(result).toEqual({ code: 'B' });
	});

	test('defaults to A when variant metadata missing for control', () => {
		const result = mapRotationToAbVariant({ variantA: null, variantB: null }, RotationVariant.CONTROL);
		expect(result).toEqual({ code: 'A' });
	});

	test('defaults to B when variant metadata missing for test', () => {
		const result = mapRotationToAbVariant({ variantA: null, variantB: null }, RotationVariant.TEST);
		expect(result).toEqual({ code: 'B' });
	});
});
