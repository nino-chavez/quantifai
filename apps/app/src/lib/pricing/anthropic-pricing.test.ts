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
		expect(upper.matchedTier).toBe('opus');

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
