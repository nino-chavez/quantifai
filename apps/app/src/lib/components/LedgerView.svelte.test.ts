import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/svelte';
import LedgerView from './LedgerView.svelte';
import type { LedgerData, UnitOfWorkRow } from '$lib/server/ledger';

function unit(overrides: Partial<UnitOfWorkRow> = {}): UnitOfWorkRow {
	return {
		unit_id: 'u1',
		kind: 'project',
		name: 'quantifai-next',
		project_path: '/Users/nino/Workspace/dev/wip/quantifai-next',
		session_count: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		commit_count: 8,
		first_session_at: '2026-07-03T10:00:00Z',
		last_session_at: '2026-07-03T18:00:00Z',
		amortized_cost: 0,
		amortized_covered_sessions: 0,
		amortized_interactive_sessions: 0,
		...overrides
	};
}

const EMPTY: LedgerData = {
	totals: {
		total_sessions: 0,
		total_cost: 0,
		metered_cost: 0,
		estimated_cost: 0,
		subscription_cost: 0,
		total_commits: 0,
		amortized_cost: 0,
		amortization_configured: false,
		amortized_covered_sessions: 0,
		amortized_interactive_sessions: 0
	},
	units: []
};

const WITH_DATA: LedgerData = {
	totals: {
		total_sessions: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		total_commits: 8,
		amortized_cost: 0,
		amortization_configured: false,
		amortized_covered_sessions: 0,
		amortized_interactive_sessions: 0
	},
	units: [unit()]
};

const WITH_AMORTIZATION: LedgerData = {
	totals: {
		total_sessions: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		total_commits: 8,
		amortized_cost: 8.1,
		amortization_configured: true,
		amortized_covered_sessions: 3,
		amortized_interactive_sessions: 3
	},
	units: [
		unit({
			amortized_cost: 8.1,
			amortized_covered_sessions: 3,
			amortized_interactive_sessions: 3
		})
	]
};

describe('LedgerView — structural invariant: one primary CTA per rendered page (DESIGN.md)', () => {
	it('renders exactly one data-primary-cta in the empty state', () => {
		const { container } = render(LedgerView, { data: EMPTY });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(1);
	});

	it('renders zero data-primary-cta once data exists — the ledger is a read surface (DESIGN.md)', () => {
		const { container } = render(LedgerView, { data: WITH_DATA });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(0);
	});
});

describe('LedgerView — empty state', () => {
	it('shows the empty-state explanation and action, not a bare "No data"', () => {
		const { getByTestId, queryByTestId } = render(LedgerView, { data: EMPTY });
		expect(getByTestId('empty-state')).toBeInTheDocument();
		expect(queryByTestId('hero')).not.toBeInTheDocument();
	});
});

describe('LedgerView — populated state', () => {
	it('renders the hero total, cost-vs-output strip, and ledger table', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_DATA });
		expect(getByTestId('hero')).toBeInTheDocument();
		expect(getByTestId('cost-vs-output-strip')).toBeInTheDocument();
		expect(getByTestId('ledger-table')).toBeInTheDocument();
		expect(within(getByTestId('hero')).getByText('$13.24')).toBeInTheDocument();
	});

	it('renders a provenance badge for a 100%-estimated unit', () => {
		const { container } = render(LedgerView, { data: WITH_DATA });
		expect(container.querySelector('.provenance-badge--estimated')).toBeTruthy();
	});
});

describe('LedgerView — amortization provenance (DESIGN.md rule 1: the honest second number)', () => {
	it('renders the "unconfigured" empty state instead of a bare $0 when no plan has been entered', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_DATA });
		expect(getByTestId('amortization-empty')).toBeInTheDocument();
	});

	it('renders both the estimated and amortized figures once a plan is configured, never summed', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_AMORTIZATION });
		const hero = getByTestId('hero');
		expect(within(hero).getByText('$13.24')).toBeInTheDocument(); // estimated, unchanged
		expect(within(getByTestId('hero-amortized')).getByText('$8.10')).toBeInTheDocument(); // amortized
		// The two never appear pre-summed anywhere (e.g. $21.34 would be the wrong, summed figure).
		expect(hero.textContent).not.toContain('21.34');
	});

	it('renders a subscription_amortized badge distinct from the estimated badge once configured', () => {
		const { container } = render(LedgerView, { data: WITH_AMORTIZATION });
		expect(container.querySelector('.provenance-badge--subscription_amortized')).toBeTruthy();
		expect(container.querySelector('.provenance-badge--estimated')).toBeTruthy();
	});
});
