import { describe, it, expect } from 'vitest';
import {
	formatUsd,
	provenanceMixLabel,
	formatCommitCount,
	formatSessionCount,
	dominantProvenance,
	amortizedCoverageLabel
} from './format';

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

describe('amortizedCoverageLabel', () => {
	it('renders the unconfigured empty state when no plan has ever been entered', () => {
		expect(
			amortizedCoverageLabel({
				amortization_configured: false,
				amortized_interactive_sessions: 5,
				amortized_covered_sessions: 0
			})
		).toBe('amortization unconfigured — set your plan fee');
	});

	it('reports full coverage once every interactive session falls under a configured plan', () => {
		expect(
			amortizedCoverageLabel({
				amortization_configured: true,
				amortized_interactive_sessions: 5,
				amortized_covered_sessions: 5
			})
		).toBe('covers all subscription sessions');
	});

	it('reports partial coverage as a fraction when some months have no covering plan', () => {
		expect(
			amortizedCoverageLabel({
				amortization_configured: true,
				amortized_interactive_sessions: 10,
				amortized_covered_sessions: 4
			})
		).toBe('covers 4/10 subscription sessions');
	});

	it('reports "no subscription sessions yet" when a plan is configured but nothing to amortize exists', () => {
		expect(
			amortizedCoverageLabel({
				amortization_configured: true,
				amortized_interactive_sessions: 0,
				amortized_covered_sessions: 0
			})
		).toBe('no subscription sessions yet');
	});
});
