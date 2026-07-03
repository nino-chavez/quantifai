import { describe, it, expect } from 'vitest';
import { amortizeByUsageShare, type SubscriptionPlan, type UsageBucket } from './amortization';

describe('amortizeByUsageShare — usage-share basis', () => {
	it('splits a fully-covered month across buckets by input+output token share', () => {
		const plans: SubscriptionPlan[] = [
			{ provider: 'anthropic', monthlyFeeUsd: 200, activeFrom: '2026-01-01', activeTo: null }
		];
		const buckets: UsageBucket[] = [
			{ key: 'a', provider: 'anthropic', month: '2026-01', usageTokens: 3000, sessionCount: 2 },
			{ key: 'b', provider: 'anthropic', month: '2026-01', usageTokens: 1000, sessionCount: 1 }
		];
		const result = amortizeByUsageShare(buckets, plans);

		const a = result.find((r) => r.key === 'a')!;
		const b = result.find((r) => r.key === 'b')!;
		expect(a.covered).toBe(true);
		expect(b.covered).toBe(true);
		expect(a.amortizedCostUsd).toBeCloseTo(150, 5); // 3000/4000 * 200
		expect(b.amortizedCostUsd).toBeCloseTo(50, 5); // 1000/4000 * 200
		expect(a.amortizedCostUsd + b.amortizedCostUsd).toBeCloseTo(200, 5); // sums to the fee, never more
	});

	it('splits evenly when every bucket in the group has zero usage tokens', () => {
		const plans: SubscriptionPlan[] = [
			{ provider: 'anthropic', monthlyFeeUsd: 100, activeFrom: '2026-01-01', activeTo: null }
		];
		const buckets: UsageBucket[] = [
			{ key: 'a', provider: 'anthropic', month: '2026-01', usageTokens: 0, sessionCount: 1 },
			{ key: 'b', provider: 'anthropic', month: '2026-01', usageTokens: 0, sessionCount: 1 }
		];
		const result = amortizeByUsageShare(buckets, plans);
		expect(result.find((r) => r.key === 'a')!.amortizedCostUsd).toBeCloseTo(50, 5);
		expect(result.find((r) => r.key === 'b')!.amortizedCostUsd).toBeCloseTo(50, 5);
	});

	it('keeps different providers in separate pools even within the same month', () => {
		const plans: SubscriptionPlan[] = [
			{ provider: 'anthropic', monthlyFeeUsd: 200, activeFrom: '2026-01-01', activeTo: null }
			// no openai plan configured
		];
		const buckets: UsageBucket[] = [
			{ key: 'claude-session', provider: 'anthropic', month: '2026-01', usageTokens: 500, sessionCount: 1 },
			{ key: 'openai-session', provider: 'openai', month: '2026-01', usageTokens: 500, sessionCount: 1 }
		];
		const result = amortizeByUsageShare(buckets, plans);
		const anthropic = result.find((r) => r.key === 'claude-session')!;
		const openai = result.find((r) => r.key === 'openai-session')!;
		expect(anthropic.covered).toBe(true);
		expect(anthropic.amortizedCostUsd).toBeCloseTo(200, 5); // sole bucket in its pool gets the whole fee
		expect(openai.covered).toBe(false);
		expect(openai.amortizedCostUsd).toBe(0);
	});

	describe('unconfigured state — no plan at all', () => {
		it('returns covered: false and $0 for every bucket when plans is empty', () => {
			const buckets: UsageBucket[] = [
				{ key: 'a', provider: 'anthropic', month: '2026-01', usageTokens: 1000, sessionCount: 3 }
			];
			const result = amortizeByUsageShare(buckets, []);
			expect(result).toEqual([
				{ key: 'a', provider: 'anthropic', month: '2026-01', amortizedCostUsd: 0, covered: false, sessionCount: 3 }
			]);
		});
	});

	describe('month boundaries', () => {
		it('prorates a plan that starts mid-month by day-overlap share, not a flat half', () => {
			// January has 31 days. Plan starts the 16th -> covers 16 days (16th..31st inclusive).
			const plans: SubscriptionPlan[] = [
				{ provider: 'anthropic', monthlyFeeUsd: 310, activeFrom: '2026-01-16', activeTo: null }
			];
			const buckets: UsageBucket[] = [
				{ key: 'only', provider: 'anthropic', month: '2026-01', usageTokens: 100, sessionCount: 1 }
			];
			const result = amortizeByUsageShare(buckets, plans);
			// 310 * (16/31) = 160
			expect(result[0].amortizedCostUsd).toBeCloseTo(160, 5);
			expect(result[0].covered).toBe(true);
		});

		it('prorates a plan that ends mid-month (activeTo inclusive) proportionally', () => {
			// 31-day month; plan active through the 15th inclusive -> 15 days covered.
			const plans: SubscriptionPlan[] = [
				{ provider: 'anthropic', monthlyFeeUsd: 620, activeFrom: '2025-06-01', activeTo: '2026-01-15' }
			];
			const buckets: UsageBucket[] = [
				{ key: 'only', provider: 'anthropic', month: '2026-01', usageTokens: 50, sessionCount: 1 }
			];
			const result = amortizeByUsageShare(buckets, plans);
			// 620 * (15/31) = 300
			expect(result[0].amortizedCostUsd).toBeCloseTo(300, 5);
		});

		it('sums two overlapping plan segments that split a single month (fee change mid-month)', () => {
			// A 31-day month where an old plan covers days 1-15 and a new plan
			// covers days 16-31 -- the classic "operator upgraded plans" case.
			const plans: SubscriptionPlan[] = [
				{ provider: 'anthropic', monthlyFeeUsd: 100, activeFrom: '2026-01-01', activeTo: '2026-01-15' },
				{ provider: 'anthropic', monthlyFeeUsd: 200, activeFrom: '2026-01-16', activeTo: null }
			];
			const buckets: UsageBucket[] = [
				{ key: 'only', provider: 'anthropic', month: '2026-01', usageTokens: 10, sessionCount: 1 }
			];
			const result = amortizeByUsageShare(buckets, plans);
			// 100*(15/31) + 200*(16/31) = 1500/31 + 3200/31 = 4700/31
			expect(result[0].amortizedCostUsd).toBeCloseTo(4700 / 31, 5);
		});

		it('attributes a session to the calendar month its bucket was grouped under, independent of neighboring months', () => {
			const plans: SubscriptionPlan[] = [
				{ provider: 'anthropic', monthlyFeeUsd: 100, activeFrom: '2026-01-01', activeTo: '2026-01-31' },
				{ provider: 'anthropic', monthlyFeeUsd: 300, activeFrom: '2026-02-01', activeTo: null }
			];
			const buckets: UsageBucket[] = [
				{ key: 'jan', provider: 'anthropic', month: '2026-01', usageTokens: 100, sessionCount: 1 },
				{ key: 'feb', provider: 'anthropic', month: '2026-02', usageTokens: 100, sessionCount: 1 }
			];
			const result = amortizeByUsageShare(buckets, plans);
			expect(result.find((r) => r.key === 'jan')!.amortizedCostUsd).toBeCloseTo(100, 5);
			expect(result.find((r) => r.key === 'feb')!.amortizedCostUsd).toBeCloseTo(300, 5);
		});
	});

	describe('mixed-provenance units — a unit with both amortizable and non-amortizable usage', () => {
		it('only amortizes buckets the caller included; buckets for API-metered sessions are the caller\'s responsibility to exclude', () => {
			// This module has no `source` concept — it trusts the caller
			// (src/lib/server/ledger.ts) to have already filtered to
			// sessions.source = 'interactive' before building buckets. Simulate
			// that by never passing a bucket for the api-metered share of a
			// unit's usage, and confirm the interactive share is still amortized
			// correctly on its own.
			const plans: SubscriptionPlan[] = [
				{ provider: 'anthropic', monthlyFeeUsd: 90, activeFrom: '2026-03-01', activeTo: null }
			];
			const interactiveOnly: UsageBucket[] = [
				{ key: 'unit-1', provider: 'anthropic', month: '2026-03', usageTokens: 900, sessionCount: 4 }
			];
			const result = amortizeByUsageShare(interactiveOnly, plans);
			expect(result).toHaveLength(1);
			expect(result[0].amortizedCostUsd).toBeCloseTo(90, 5);
			expect(result[0].sessionCount).toBe(4); // passthrough, unaffected by the math
		});
	});
});
