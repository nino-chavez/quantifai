import { describe, it, expect } from 'vitest';
import { normalizeOpenRouterCredits, openrouterProvider, type OpenRouterCreditsResponse } from './openrouter';

const FIXTURE: OpenRouterCreditsResponse = {
	data: { total_credits: 100, total_usage: 37.42 }
};

describe('normalizeOpenRouterCredits — OpenRouter adapter (disabled, code-complete, documented limitation)', () => {
	it('normalizes to a single "org" sentinel row keyed on the given as-of date', () => {
		const rows = normalizeOpenRouterCredits(FIXTURE, '2026-07-03');
		expect(rows).toEqual([
			expect.objectContaining({
				provider: 'openrouter',
				date: '2026-07-03',
				workspaceOrKey: 'org',
				amountUsd: 37.42,
				currency: 'USD'
			})
		]);
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
