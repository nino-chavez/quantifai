import { describe, it, expect } from 'vitest';
import { formatUsd, provenanceMixLabel, formatCommitCount, formatSessionCount, dominantProvenance } from './format';

describe('formatUsd', () => {
	it('formats whole dollars without cents for larger amounts', () => {
		expect(formatUsd(98229.29)).toBe('$98,229');
	});

	it('keeps cents for small amounts under $100', () => {
		expect(formatUsd(13.24)).toBe('$13.24');
	});

	it('renders exactly $0 for zero, not $0.00', () => {
		expect(formatUsd(0)).toBe('$0');
	});
});

describe('provenanceMixLabel', () => {
	it('reports 100% estimated when the whole total is estimated (this slice\'s only provenance today)', () => {
		const label = provenanceMixLabel({
			total_cost: 100,
			metered_cost: 0,
			estimated_cost: 100,
			subscription_cost: 0
		});
		expect(label).toBe('100% estimated');
	});

	it('discloses a mixed total across all three provenances', () => {
		const label = provenanceMixLabel({
			total_cost: 100,
			metered_cost: 40,
			estimated_cost: 30,
			subscription_cost: 30
		});
		expect(label).toBe('40% metered · 30% estimated · 30% subscription');
	});

	it('reports "no cost recorded yet" for a zero total rather than dividing by zero', () => {
		expect(
			provenanceMixLabel({ total_cost: 0, metered_cost: 0, estimated_cost: 0, subscription_cost: 0 })
		).toBe('no cost recorded yet');
	});
});

describe('dominantProvenance', () => {
	it('returns "estimated" when the whole cost is estimated', () => {
		expect(
			dominantProvenance({ total_cost: 100, metered_cost: 0, estimated_cost: 100, subscription_cost: 0 })
		).toBe('estimated');
	});

	it('returns null for a genuinely mixed breakdown (render the text mix, not a single badge)', () => {
		expect(
			dominantProvenance({ total_cost: 100, metered_cost: 50, estimated_cost: 50, subscription_cost: 0 })
		).toBeNull();
	});

	it('returns null for a zero total', () => {
		expect(
			dominantProvenance({ total_cost: 0, metered_cost: 0, estimated_cost: 0, subscription_cost: 0 })
		).toBeNull();
	});
});

describe('formatCommitCount', () => {
	it('pluralizes correctly and flags zero as "no commits linked" (the v0 honesty label)', () => {
		expect(formatCommitCount(0)).toBe('no commits linked');
		expect(formatCommitCount(1)).toBe('1 commit');
		expect(formatCommitCount(8)).toBe('8 commits');
	});
});

describe('formatSessionCount', () => {
	it('pluralizes sessions', () => {
		expect(formatSessionCount(1)).toBe('1 session');
		expect(formatSessionCount(3)).toBe('3 sessions');
	});
});
