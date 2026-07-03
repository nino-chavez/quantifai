import { describe, it, expect } from 'vitest';
import {
	normalizeOpenRouterActivity,
	computeHistoricalRemainder,
	openrouterProvider,
	HISTORICAL_REMAINDER_DATE,
	HISTORICAL_REMAINDER_WORKSPACE,
	type OpenRouterActivityResponse
} from './openrouter';

// Shape verified live 2026-07-03 against the operator's real OpenRouter
// Management API key — see the module header for the full derivation.
const ACTIVITY_FIXTURE: OpenRouterActivityResponse = {
	data: [
		{ date: '2026-06-27 00:00:00', usage: 2.25905, byok_usage_inference: 0 },
		{ date: '2026-06-27 00:00:00', usage: 1.554344, byok_usage_inference: 0 },
		{ date: '2026-06-24 00:00:00', usage: 1.52709, byok_usage_inference: 0 },
		{ date: '2026-06-22 00:00:00', usage: 0.097774, byok_usage_inference: 0 }
	]
};

describe('normalizeOpenRouterActivity', () => {
	it('aggregates multiple per-model rows into one row per calendar date', () => {
		const rows = normalizeOpenRouterActivity(ACTIVITY_FIXTURE);

		expect(rows).toHaveLength(3);
		const jun27 = rows.find((r) => r.date === '2026-06-27');
		expect(jun27).toMatchObject({
			provider: 'openrouter',
			date: '2026-06-27',
			workspaceOrKey: 'org',
			amountUsd: 2.25905 + 1.554344,
			currency: 'USD'
		});
	});

	it('sums usage + byok_usage_inference per row rather than dropping BYOK spend', () => {
		const rows = normalizeOpenRouterActivity({
			data: [{ date: '2026-06-20 00:00:00', usage: 1, byok_usage_inference: 0.5 }]
		});

		expect(rows).toEqual([expect.objectContaining({ date: '2026-06-20', amountUsd: 1.5 })]);
	});

	it('defaults a missing byok_usage_inference to 0 rather than throwing', () => {
		const rows = normalizeOpenRouterActivity({
			data: [{ date: '2026-06-19 00:00:00', usage: 3 }] as unknown as OpenRouterActivityResponse['data']
		});

		expect(rows).toEqual([expect.objectContaining({ amountUsd: 3 })]);
	});

	it('returns no rows for an empty activity window', () => {
		expect(normalizeOpenRouterActivity({ data: [] })).toEqual([]);
	});
});

describe('computeHistoricalRemainder', () => {
	it('derives the pre-activity-window remainder from lifetime total minus the activity sum', () => {
		const rows = normalizeOpenRouterActivity(ACTIVITY_FIXTURE);
		const activitySum = rows.reduce((sum, r) => sum + r.amountUsd, 0);

		const remainder = computeHistoricalRemainder(129.97515418, rows);

		expect(remainder).toMatchObject({
			provider: 'openrouter',
			date: HISTORICAL_REMAINDER_DATE,
			workspaceOrKey: HISTORICAL_REMAINDER_WORKSPACE,
			currency: 'USD'
		});
		expect(remainder?.amountUsd).toBeCloseTo(129.97515418 - activitySum, 10);
	});

	it('never double-counts: remainder + activity sum reconstitutes the lifetime total exactly', () => {
		const rows = normalizeOpenRouterActivity(ACTIVITY_FIXTURE);
		const activitySum = rows.reduce((sum, r) => sum + r.amountUsd, 0);
		const remainder = computeHistoricalRemainder(129.97515418, rows);

		expect(activitySum + (remainder?.amountUsd ?? 0)).toBeCloseTo(129.97515418, 10);
	});

	it('skips the remainder row when the activity window already covers the full lifetime total (remainder <= 0)', () => {
		const rows = normalizeOpenRouterActivity(ACTIVITY_FIXTURE);
		const activitySum = rows.reduce((sum, r) => sum + r.amountUsd, 0);

		expect(computeHistoricalRemainder(activitySum, rows)).toBeNull();
		expect(computeHistoricalRemainder(activitySum - 0.01, rows)).toBeNull();
	});

	it('skips the remainder row for a zero-activity, zero-lifetime account rather than writing a $0 row', () => {
		expect(computeHistoricalRemainder(0, [])).toBeNull();
	});
});

describe('openrouterProvider — disabled-provider state (DESIGN.md rule 7)', () => {
	it('is not connected without OPENROUTER_API_KEY', () => {
		expect(openrouterProvider.isConnected({})).toBe(false);
	});

	it('is connected once the secret exists', () => {
		expect(openrouterProvider.isConnected({ OPENROUTER_API_KEY: 'sk-or-x' })).toBe(true);
	});

	it('throws rather than silently returning empty if fetchWindow is called while disconnected', async () => {
		await expect(openrouterProvider.fetchWindow({ sinceIso: '2026-01-01T00:00:00Z' }, {})).rejects.toThrow(
			/OPENROUTER_API_KEY/
		);
	});
});
