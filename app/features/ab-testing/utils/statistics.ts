import type { ABTestEvent, ABTestStats, SerializedABTestEvent } from '../types';

export function calculateStatistics(events: ABTestEvent[] | SerializedABTestEvent[] | any[]): ABTestStats {
	const variantAEvents = events.filter(e => e.variant === 'A');
	const variantBEvents = events.filter(e => e.variant === 'B');

	const variantAImpressions = variantAEvents.filter(e => e.eventType === 'IMPRESSION').length;
	const variantBImpressions = variantBEvents.filter(e => e.eventType === 'IMPRESSION').length;

	const variantAAddToCarts = variantAEvents.filter(e => e.eventType === 'ADD_TO_CART').length;
	const variantBAddToCarts = variantBEvents.filter(e => e.eventType === 'ADD_TO_CART').length;

	const variantAPurchases = variantAEvents.filter(e => e.eventType === 'PURCHASE').length;
	const variantBPurchases = variantBEvents.filter(e => e.eventType === 'PURCHASE').length;

	const variantARevenue = variantAEvents
		.filter(e => e.eventType === 'PURCHASE')
		.reduce((sum, e) => sum + (e.revenue || 0), 0);
	const variantBRevenue = variantBEvents
		.filter(e => e.eventType === 'PURCHASE')
		.reduce((sum, e) => sum + (e.revenue || 0), 0);

	const variantARate = variantAImpressions > 0 ? variantAAddToCarts / variantAImpressions : 0;
	const variantBRate = variantBImpressions > 0 ? variantBAddToCarts / variantBImpressions : 0;

	// Calculate statistical significance using z-test for proportions
	const n1 = variantAImpressions;
	const n2 = variantBImpressions;
	const p1 = variantARate;
	const p2 = variantBRate;

	let zScore = 0;
	let pValue = 1;
	let confidence = 0;

	if (n1 > 0 && n2 > 0 && variantAAddToCarts + variantBAddToCarts > 0) {
		const pooledP = (variantAAddToCarts + variantBAddToCarts) / (n1 + n2);
		const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));

		if (se > 0) {
			zScore = Math.abs(p1 - p2) / se;
			// Approximate p-value using normal distribution
			pValue = 2 * (1 - normalCdf(zScore));
			confidence = Math.max(0, (1 - pValue) * 100);
		}
	}

	// Calculate lift (percentage improvement of B over A)
	const lift = variantARate > 0 ? ((variantBRate - variantARate) / variantARate) * 100 : 0;

	// Determine winner
	let winner: 'A' | 'B' | null = null;
	if (confidence >= 95) {
		winner = variantBRate > variantARate ? 'B' : variantARate > variantBRate ? 'A' : null;
	}

	return {
		variantA: {
			impressions: variantAImpressions,
			addToCarts: variantAAddToCarts,
			purchases: variantAPurchases,
			revenue: variantARevenue,
			conversions: variantAAddToCarts, // backwards compatibility
			rate: variantARate,
			ratePercent: (variantARate * 100).toFixed(2),
		},
		variantB: {
			impressions: variantBImpressions,
			addToCarts: variantBAddToCarts,
			purchases: variantBPurchases,
			revenue: variantBRevenue,
			conversions: variantBAddToCarts, // backwards compatibility
			rate: variantBRate,
			ratePercent: (variantBRate * 100).toFixed(2),
		},
		lift: lift.toFixed(2),
		confidence: confidence.toFixed(1),
		isSignificant: confidence >= 95,
		winner,
		sampleSize: n1 + n2,
	};
}

// Approximation of cumulative distribution function for standard normal distribution
function normalCdf(x: number): number {
	// Abramowitz and Stegun approximation
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = x < 0 ? -1 : 1;
	x = Math.abs(x) / Math.sqrt(2.0);

	const t = 1.0 / (1.0 + p * x);
	const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

	return 0.5 * (1.0 + sign * y);
}

export function calculateSampleSizeNeeded(
	baselineRate: number,
	minimumDetectableEffect: number,
	power: number = 0.8,
	significance: number = 0.05,
): number {
	// Sample size calculation for two-proportion z-test
	const alpha = significance;
	const beta = 1 - power;

	const zAlpha = normalInverse(1 - alpha / 2);
	const zBeta = normalInverse(1 - beta);

	const p1 = baselineRate;
	const p2 = baselineRate * (1 + minimumDetectableEffect);

	const pooledP = (p1 + p2) / 2;
	const numerator = Math.pow(
		zAlpha * Math.sqrt(2 * pooledP * (1 - pooledP)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)),
		2,
	);
	const denominator = Math.pow(p2 - p1, 2);

	return Math.ceil(numerator / denominator);
}

// Approximation of inverse normal CDF
function normalInverse(p: number): number {
	// Beasley-Springer-Moro approximation
	const a0 = -39.69683028665376;
	const a1 = 220.9460984245205;
	const a2 = -275.9285104469687;
	const a3 = 138.357751867269;
	const a4 = -30.66479806614716;
	const a5 = 2.506628277459239;

	const b1 = -54.47609879822406;
	const b2 = 161.5858368580409;
	const b3 = -155.6989798598866;
	const b4 = 66.80131188771972;
	const b5 = -13.28068155288572;

	const c0 = -7.784894002430293e-3;
	const c1 = -3.223964580411365e-1;
	const c2 = -2.400758277161838;
	const c3 = -2.549732539343734;
	const c4 = 4.374664141464968;
	const c5 = 2.938163982698783;

	const d1 = 7.784695709041462e-3;
	const d2 = 3.224671290700398e-1;
	const d3 = 2.445134137142996;
	const d4 = 3.754408661907416;

	if (p <= 0 || p >= 1) {
		throw new Error('Probability must be between 0 and 1');
	}

	if (p < 0.02425) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c5 * q + c4) * q + c3) * q + c2) * q + c1) * q + c0) / ((((d4 * q + d3) * q + d2) * q + d1) * q + 1)
		);
	} else if (p < 0.97575) {
		const q = p - 0.5;
		const r = q * q;
		return (
			((((((a5 * r + a4) * r + a3) * r + a2) * r + a1) * r + a0) * q) /
			(((((b5 * r + b4) * r + b3) * r + b2) * r + b1) * r + 1)
		);
	} else {
		const q = Math.sqrt(-2 * Math.log(1 - p));
		return (
			-(((((c5 * q + c4) * q + c3) * q + c2) * q + c1) * q + c0) / ((((d4 * q + d3) * q + d2) * q + d1) * q + 1)
		);
	}
}
