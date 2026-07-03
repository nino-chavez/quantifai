import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/svelte';
import PracticeNumbersView from './PracticeNumbersView.svelte';
import type { PracticeNumbersData } from '$lib/practice-numbers-shared';

function project(overrides: Partial<PracticeNumbersData['projects'][number]> = {}) {
	return {
		unit_id: 'u1',
		kind: 'initiative' as const,
		name: 'quantifai-next',
		project_path: '/Users/nino/Workspace/dev/wip/quantifai-next',
		session_count: 12,
		estimated_cost: 45.5,
		amortized_cost: 30.0,
		amortized_covered_sessions: 12,
		amortized_interactive_sessions: 12,
		commit_count: 8,
		merge_count: 2,
		...overrides
	};
}

const EMPTY: PracticeNumbersData = {
	window: { label: '30', days: 30, sinceIso: '2026-06-03T00:00:00.000Z' },
	asOf: '2026-07-03T12:00:00.000Z',
	amortizationConfigured: false,
	projects: [],
	rates: {
		weeks: 4.2857,
		commits_per_week: 0,
		merges_per_week: 0,
		sessions_per_week: 0,
		estimated_cost_per_week: 0,
		amortized_cost_per_week: null,
		deploys_per_week: null
	}
};

const WITH_DATA: PracticeNumbersData = {
	window: { label: '30', days: 30, sinceIso: '2026-06-03T00:00:00.000Z' },
	asOf: '2026-07-03T12:00:00.000Z',
	amortizationConfigured: true,
	projects: [project()],
	rates: {
		weeks: 4.2857,
		commits_per_week: 1.87,
		merges_per_week: 0.47,
		sessions_per_week: 2.8,
		estimated_cost_per_week: 10.62,
		amortized_cost_per_week: 7.0,
		deploys_per_week: null
	}
};

describe('PracticeNumbersView — structural invariant: exactly one primary CTA (DESIGN.md)', () => {
	it('renders exactly one data-primary-cta ("Export numbers") in the empty state', () => {
		const { container } = render(PracticeNumbersView, { data: EMPTY });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(1);
	});

	it('renders exactly one data-primary-cta once data exists', () => {
		const { container } = render(PracticeNumbersView, { data: WITH_DATA });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(1);
	});

	it('labels the one CTA "Export numbers" per DESIGN.md\'s per-page CTA table', () => {
		const { getByRole } = render(PracticeNumbersView, { data: WITH_DATA });
		expect(getByRole('button', { name: /export numbers/i })).toBeInTheDocument();
	});
});

describe('PracticeNumbersView — empty state', () => {
	it('shows the empty-state explanation, not a bare "No data"', () => {
		const { getByTestId } = render(PracticeNumbersView, { data: EMPTY });
		expect(getByTestId('empty-state')).toBeInTheDocument();
	});

	it('keeps the export button present (though the window is empty) rather than removing it', () => {
		const { getByRole } = render(PracticeNumbersView, { data: EMPTY });
		expect(getByRole('button', { name: /export numbers/i })).toBeInTheDocument();
	});
});

describe('PracticeNumbersView — populated state', () => {
	it('renders the project table, practice rates, and an as-of date', () => {
		const { getByTestId } = render(PracticeNumbersView, { data: WITH_DATA });
		expect(getByTestId('project-table')).toBeInTheDocument();
		expect(getByTestId('practice-rates')).toBeInTheDocument();
		expect(getByTestId('as-of')).toBeInTheDocument();
	});

	it('renders both estimated and amortized cost per project, never summed', () => {
		const { getByTestId } = render(PracticeNumbersView, { data: WITH_DATA });
		const table = getByTestId('project-table');
		expect(within(table).getByText('$45.50')).toBeInTheDocument(); // estimated
		expect(within(table).getByText(/\$30\.00/)).toBeInTheDocument(); // amortized (with coverage note)
		expect(table.textContent).not.toContain('75.50'); // 45.50 + 30.00 would be the wrong, summed figure
	});

	it('renders "not instrumented" for deploys/week, never a merge-count proxy', () => {
		const { getByTestId } = render(PracticeNumbersView, { data: WITH_DATA });
		expect(getByTestId('deploys-not-instrumented')).toHaveTextContent('not instrumented');
	});

	it('renders the amortization-unconfigured note in the rate table when unconfigured', () => {
		const unconfigured: PracticeNumbersData = {
			...WITH_DATA,
			amortizationConfigured: false,
			rates: { ...WITH_DATA.rates, amortized_cost_per_week: null }
		};
		const { getByTestId } = render(PracticeNumbersView, { data: unconfigured });
		expect(getByTestId('amortized-rate')).toHaveTextContent(/unconfigured/i);
	});
});
