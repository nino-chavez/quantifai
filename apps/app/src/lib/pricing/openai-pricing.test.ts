import { describe, it, expect } from 'vitest';
import { estimateOpenAICost } from './openai-pricing';

const ONE_M = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 };

describe('estimateOpenAICost', () => {
	it('prices gpt-6-astra at published per-1M rates', () => {
		const r = estimateOpenAICost('gpt-6-astra', ONE_M);
		expect(r.costUsd).toBeCloseTo(10 + 50 + 1, 6);
		expect(r.matched).toBe(true);
	});

	it('distinguishes gpt-6-sol from gpt-6.1-sol (exact match, not substring)', () => {
		const sol = estimateOpenAICost('gpt-6-sol', ONE_M);
		const sol61 = estimateOpenAICost('gpt-6.1-sol', ONE_M);
		expect(sol.costUsd).toBeCloseTo(2 + 10 + 0.2, 6);
		expect(sol61.costUsd).toBeCloseTo(2 + 10 + 0.1, 6);
	});

	it('returns unpriced, not a guessed fallback, for an unlisted model', () => {
		const r = estimateOpenAICost('codex-auto-review', ONE_M);
		expect(r).toEqual({ costUsd: 0, matched: false, matchedTier: 'unpriced' });
	});

	it('does not match a near-miss model string', () => {
		expect(estimateOpenAICost('gpt-6-astra-preview', ONE_M).matched).toBe(false);
	});
});
