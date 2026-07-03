/**
 * Shared (client-safe) types, window resolution, and methodology copy for
 * the practice-numbers page. Split from src/lib/server/practice-numbers.ts
 * because SvelteKit forbids importing `$lib/server/*` into client code, and
 * the page component + export builders legitimately need the data shape and
 * the methodology strings (they render/emit them verbatim). Nothing in this
 * module touches D1.
 */

export type WindowLabel = '30' | '90' | 'all';

export interface WindowSpec {
	label: WindowLabel;
	days: number | null;
	sinceIso: string | null;
}

export function resolveWindow(param: string | null, now: Date = new Date()): WindowSpec {
	const label: WindowLabel = param === '90' ? '90' : param === 'all' ? 'all' : '30';
	const days = label === 'all' ? null : Number(label);
	const sinceIso = days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
	return { label, days, sinceIso };
}

export interface ProjectRow {
	unit_id: string;
	kind: 'initiative' | 'project' | 'session';
	name: string;
	project_path: string;
	session_count: number;
	estimated_cost: number;
	amortized_cost: number;
	amortized_covered_sessions: number;
	amortized_interactive_sessions: number;
	commit_count: number;
	merge_count: number;
}

export interface PracticeRates {
	weeks: number;
	commits_per_week: number;
	merges_per_week: number;
	sessions_per_week: number;
	estimated_cost_per_week: number;
	/** null when amortization is unconfigured — never a guessed figure. */
	amortized_cost_per_week: number | null;
	/** sum(provider_costs.amount_usd) for dates in window / weeks — REAL spend, daily-aggregate grain (slice 3). Always a number (0 when no provider is connected/synced yet), never null — unlike amortized_cost_per_week, "no provider data yet" and "$0 metered" are the same observable state, so there's no separate unconfigured case to disclose. */
	api_metered_cost_per_week: number;
	/** `amortized_cost_per_week` (when configured) + `api_metered_cost_per_week` — never summed with `estimated_cost_per_week` (money semantics, src/lib/server/ledger.ts). */
	actual_spend_per_week: number;
	/** Always null — no deploy signal is instrumented yet (DESIGN.md: render honestly, don't proxy from merges). */
	deploys_per_week: null;
}

export interface PracticeNumbersData {
	window: WindowSpec;
	asOf: string;
	amortizationConfigured: boolean;
	projects: ProjectRow[];
	rates: PracticeRates;
}

export const METHODOLOGY = {
	commits: 'git_events count (authored_at in window) across all configured repos, divided by weeks in the window.',
	merges: 'git_events with 2+ parents (classified from `git log --pretty=%P` at import time), divided by weeks in the window.',
	sessions: 'sessions with started_at in window, divided by weeks in the window.',
	estimatedCostPerWeek:
		'sum(sessions.total_cost) for sessions started in window, divided by weeks — list-price token valuation, not a metered bill (see src/lib/pricing/anthropic-pricing.ts).',
	amortizedCostPerWeek:
		'sum of covered amortized cost (src/lib/pricing/amortization.ts: plan fee spread by input+output token share, month by month) for interactive sessions in window, divided by weeks.',
	apiMeteredCostPerWeek:
		'sum(provider_costs.amount_usd) for dates in window (src/lib/providers/ — daily-aggregate spend pulled from each connected provider\'s cost API), divided by weeks. Real spend, not a token valuation.',
	actualSpendPerWeek:
		'amortized cost/week (when configured) + API-metered cost/week — both are real spend and compose; never summed with estimated cost/week (list-price token valuation is not spend).',
	deploysPerWeek: 'not instrumented — no deploy signal exists yet; deliberately not proxied from merge count.'
} as const;
