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
		total_commits: 0
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
		total_commits: 8
	},
	units: [unit()]
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
