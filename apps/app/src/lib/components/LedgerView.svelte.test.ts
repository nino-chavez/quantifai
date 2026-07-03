import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/svelte';
import LedgerView from './LedgerView.svelte';
import type { LedgerData, ProviderBucketRow, UnitOfWorkRow } from '$lib/server/ledger';

function providerBucket(overrides: Partial<ProviderBucketRow> = {}): ProviderBucketRow {
	return {
		kind: 'provider-bucket',
		provider: 'anthropic',
		total_amount_usd: 0,
		days_covered: 0,
		earliest_date: null,
		latest_date: null,
		last_sync_status: 'not_connected',
		last_sync_at: null,
		last_sync_error: null,
		...overrides
	};
}

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
		deterministic_commit_count: 0,
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
		deterministic_commits: 0,
		amortized_cost: 0,
		amortization_configured: false,
		amortized_covered_sessions: 0,
		amortized_interactive_sessions: 0,
		provider_metered_cost: 0,
		actual_spend: 0
	},
	units: [],
	providerBuckets: [providerBucket(), providerBucket({ provider: 'openai' }), providerBucket({ provider: 'openrouter' })]
};

const WITH_DATA: LedgerData = {
	totals: {
		total_sessions: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		total_commits: 8,
		deterministic_commits: 0,
		amortized_cost: 0,
		amortization_configured: false,
		amortized_covered_sessions: 0,
		amortized_interactive_sessions: 0,
		provider_metered_cost: 0,
		actual_spend: 0
	},
	units: [unit()],
	providerBuckets: [providerBucket()]
};

const WITH_AMORTIZATION: LedgerData = {
	totals: {
		total_sessions: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		total_commits: 8,
		deterministic_commits: 0,
		amortized_cost: 8.1,
		amortization_configured: true,
		amortized_covered_sessions: 3,
		amortized_interactive_sessions: 3,
		provider_metered_cost: 0,
		actual_spend: 8.1
	},
	units: [
		unit({
			amortized_cost: 8.1,
			amortized_covered_sessions: 3,
			amortized_interactive_sessions: 3
		})
	],
	providerBuckets: [providerBucket()]
};

const WITH_ACTUAL_SPEND: LedgerData = {
	totals: {
		total_sessions: 3,
		total_cost: 13.24,
		metered_cost: 0,
		estimated_cost: 13.24,
		subscription_cost: 0,
		total_commits: 8,
		deterministic_commits: 0,
		amortized_cost: 8.1,
		amortization_configured: true,
		amortized_covered_sessions: 3,
		amortized_interactive_sessions: 3,
		provider_metered_cost: 5.5,
		actual_spend: 13.6
	},
	units: [
		unit({
			amortized_cost: 8.1,
			amortized_covered_sessions: 3,
			amortized_interactive_sessions: 3
		})
	],
	providerBuckets: [
		providerBucket({
			total_amount_usd: 5.5,
			days_covered: 12,
			last_sync_status: 'ok',
			last_sync_at: '2026-07-03T06:00:00Z'
		}),
		providerBucket({ provider: 'openai', last_sync_status: 'not_connected' })
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

describe('LedgerView — linkage quality (ADR-0004: git-notes deterministic vs. time-window)', () => {
	it('renders a bare commit count in the ledger table when nothing is git-notes-linked yet', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_DATA });
		expect(within(getByTestId('ledger-table')).getByText('8')).toBeInTheDocument();
	});

	it('surfaces the deterministic subset inline once some commits carry a git-note', () => {
		const withDeterministic: LedgerData = {
			...WITH_DATA,
			totals: { ...WITH_DATA.totals, total_commits: 8, deterministic_commits: 3 },
			units: [unit({ commit_count: 8, deterministic_commit_count: 3 })]
		};
		const { getByTestId } = render(LedgerView, { data: withDeterministic });
		expect(within(getByTestId('hero')).getByText(/3 deterministic/)).toBeInTheDocument();
		expect(within(getByTestId('ledger-table')).getByText('8 (3 deterministic)')).toBeInTheDocument();
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

describe('LedgerView — actual spend (money semantics: amortized + api_metered compose, estimated never joins)', () => {
	it('renders amortized + api_metered composed into actual spend, distinct from (never equal to) estimated', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		const actualSpend = getByTestId('hero-actual-spend');
		// 8.1 (amortized) + 5.5 (api metered) = 13.6 — the correct composed figure.
		expect(within(actualSpend).getByText('$13.60')).toBeInTheDocument();
	});

	it('never renders estimated + actual_spend summed together anywhere on the page', () => {
		const { container } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		// 13.24 (estimated) + 13.6 (actual spend) = 26.84 would be the wrong, cross-family sum.
		expect(container.textContent).not.toContain('26.84');
	});

	it('uses a distinct composite badge, not one of the three single-provenance badges, for actual spend', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		expect(getByTestId('hero-actual-spend').querySelector('.provenance-badge--actual_spend')).toBeTruthy();
	});
});

describe('LedgerView — provider buckets (DESIGN.md rule 7: unconnected renders honestly, never as an error)', () => {
	it('renders a "not connected" state for a provider with no secret, never an error or empty chart', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		expect(getByTestId('not-connected-openai')).toHaveTextContent(/not connected/i);
	});

	it('renders the connected provider bucket amount and day coverage, never folded into a unit-of-work row', () => {
		const { getByTestId } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		const bucket = getByTestId('provider-bucket-anthropic');
		expect(within(bucket).getByText('$5.50')).toBeInTheDocument();
		expect(within(bucket).getByText(/12 days/)).toBeInTheDocument();
	});

	it('surfaces last_sync_error when a provider sync failed (DESIGN.md connections-panel organism: error is user-visible)', () => {
		const withError: LedgerData = {
			...WITH_ACTUAL_SPEND,
			providerBuckets: [
				providerBucket({ last_sync_status: 'error', last_sync_error: 'Anthropic cost_report 500: internal error' })
			]
		};
		const { getByTestId } = render(LedgerView, { data: withError });
		expect(getByTestId('sync-error-anthropic')).toHaveTextContent('Anthropic cost_report 500');
	});

	it('renders the provider-buckets section even when no sessions have been imported yet (independent of unit-of-work data)', () => {
		const providerOnlyEmpty: LedgerData = { ...EMPTY, providerBuckets: WITH_ACTUAL_SPEND.providerBuckets };
		const { getByTestId } = render(LedgerView, { data: providerOnlyEmpty });
		expect(getByTestId('empty-state')).toBeInTheDocument(); // still an empty ledger (no units)
		expect(getByTestId('provider-bucket-anthropic')).toBeInTheDocument(); // but provider data still shows
	});

	it('adds no additional data-primary-cta from the provider-buckets section (read-only, DESIGN.md one-primary-CTA rule)', () => {
		const { container } = render(LedgerView, { data: WITH_ACTUAL_SPEND });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(0);
	});
});
