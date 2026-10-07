import { describe, it, expect } from 'vitest';
import { estimateAnthropicCost } from './anthropic-pricing';

describe('estimateAnthropicCost', () => {
	it('prices a sonnet session at published per-1M rates', () => {
		const result = estimateAnthropicCost('claude-sonnet-4-5', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		});
		expect(result.costUsd).toBeCloseTo(3.0 + 15.0, 6);
		expect(result.matched).toBe(true);
		expect(result.matchedTier).toBe('sonnet');
	});

	it('prices an opus session higher than sonnet for identical usage', () => {
		const usage = {
			inputTokens: 100_000,
			outputTokens: 50_000,
			cacheReadTokens: 20_000,
			cacheCreationTokens: 10_000
		};
		const opus = estimateAnthropicCost('claude-opus-4-8', usage);
		const sonnet = estimateAnthropicCost('claude-sonnet-4-5', usage);
		expect(opus.costUsd).toBeGreaterThan(sonnet.costUsd);
	});

	it('prices a haiku session lower than sonnet for identical usage', () => {
		const usage = {
			inputTokens: 100_000,
			outputTokens: 50_000,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		};
		const haiku = estimateAnthropicCost('claude-haiku-4-5', usage);
		const sonnet = estimateAnthropicCost('claude-sonnet-4-5', usage);
		expect(haiku.costUsd).toBeLessThan(sonnet.costUsd);
	});

	it('accounts for cache read and cache creation tokens separately from base input', () => {
		const noCaching = estimateAnthropicCost('claude-sonnet-4-5', {
			inputTokens: 1000,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		});
		const withCacheRead = estimateAnthropicCost('claude-sonnet-4-5', {
			inputTokens: 1000,
			outputTokens: 0,
			cacheReadTokens: 1_000_000,
			cacheCreationTokens: 0
		});
		// cache-read rate (0.30/1M) is cheaper than base input rate (3.00/1M) —
		// a session with cache reads should not price as if they were base input.
		expect(withCacheRead.costUsd).toBeLessThan(noCaching.costUsd + 3.0);
		expect(withCacheRead.costUsd).toBeCloseTo(noCaching.costUsd + 0.3, 6);
	});

	it('falls back to sonnet-tier pricing for an unrecognized model string and flags it unmatched', () => {
		const result = estimateAnthropicCost('some-future-model-9000', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		});
		expect(result.matched).toBe(false);
		expect(result.matchedTier).toBe('sonnet');
		expect(result.costUsd).toBeCloseTo(3.0, 6);
	});

	it('is case-insensitive and handles an empty/undefined model gracefully', () => {
		const upper = estimateAnthropicCost('CLAUDE-OPUS-4', {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		});
		expect(upper.matchedTier).toBe('opus-4');

		const empty = estimateAnthropicCost('', {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0
		});
		expect(empty.matched).toBe(false);
		expect(empty.costUsd).toBe(0);
	});
});

describe('estimateAnthropicCost — versioned rows (pricing page read 2026-10-07)', () => {
	const perMillion = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 };

	it.each([
		['claude-opus-5-5', 'opus-5-5', 4 + 20],
		['claude-opus-4-8', 'opus-4-8', 5 + 25],
		['claude-opus-4-5-20251101', 'opus-4-5', 5 + 25],
		['claude-opus-4-1-20250805', 'opus-4', 15 + 75],
		['claude-sonnet-5-5', 'sonnet-5-5', 2 + 10],
		['claude-sonnet-4-6', 'sonnet', 3 + 15],
		['claude-fable-5-1', 'fable-5-1', 10 + 50],
		['claude-haiku-4-5-20251001', 'haiku-4-5', 1 + 5],
		// A 1M-token prompt is over Haiku 5.5's 100k cutoff, so long-prompt rates apply.
		['anthropic.claude-haiku-5-5', 'haiku-5-5', 0.5 + 2.5],
		['claude-3-5-haiku-20241022', 'haiku', 0.8 + 4]
	])('%s matches %s', (model, tier, cost) => {
		const r = estimateAnthropicCost(model, perMillion);
		expect(r.matched).toBe(true);
		expect(r.matchedTier).toBe(tier);
		expect(r.costUsd).toBeCloseTo(cost, 6);
	});

	it('does not let a shorter key shadow a newer version', () => {
		// "opus-5" is a substring of "opus-5-5"; first match must be the 5.5 row.
		expect(estimateAnthropicCost('claude-opus-5-5', perMillion).matchedTier).toBe('opus-5-5');
		expect(estimateAnthropicCost('claude-opus-5', perMillion).matchedTier).toBe('opus-5');
	});

	it('prices Claude Haiku 5.5 by prompt length, with the cutoff at 100,000 prompt tokens', () => {
		const at = estimateAnthropicCost('claude-haiku-5-5', {
			inputTokens: 1_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 98_000,
			cacheCreationTokens: 1_000
		});
		// 100,000 prompt tokens is not over the cutoff: short-prompt rates.
		expect(at.costUsd).toBeCloseTo((1_000 * 0.1 + 98_000 * 0.01 + 1_000 * 0.125) / 1e6 + 0.5, 9);

		const over = estimateAnthropicCost('claude-haiku-5-5', {
			inputTokens: 1_001,
			outputTokens: 1_000_000,
			cacheReadTokens: 98_000,
			cacheCreationTokens: 1_000
		});
		// One token over: every category, output included, moves to long-prompt rates.
		expect(over.costUsd).toBeCloseTo((1_001 * 0.5 + 98_000 * 0.05 + 1_000 * 0.625) / 1e6 + 2.5, 9);
		expect(over.matchedTier).toBe('haiku-5-5');
	});
});
