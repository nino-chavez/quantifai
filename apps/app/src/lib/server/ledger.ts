/**
 * Server-side data access for the unit-of-work ledger page. Plain
 * parameterized SQL against the D1 binding — SQLite translation of the
 * Postgres `get_ledger_totals()` / `get_unit_of_work_ledger()` functions
 * (supabase/migrations/20260703000001_functions.sql). ADR-0005: those
 * existed only to dodge PostgREST's default 1000-row cap; a Worker querying
 * D1 directly has no such cap, so this is plain SQL, not RPC indirection.
 *
 * SQLite has no aggregate `FILTER (WHERE ...)`-through-plpgsql-RETURNS-TABLE
 * ambiguity to work around (that was a Postgres-function-specific wrinkle),
 * but D1's SQLite build is conservative about the standard `FILTER` clause,
 * so the provenance-mix sums use `SUM(CASE WHEN ... THEN x ELSE 0 END)` for
 * portability.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { computeAmortizationRollup } from './amortization-query';
import { listSubscriptionPlans } from './subscription-plans';
import { providerCostTotals, providerCostGrandTotal, type ProviderCostTotal } from './provider-costs';
import { allSyncStates, type ProviderSyncStateRow, type SyncStatus } from './provider-sync-state';
import { ALL_PROVIDERS } from '$lib/providers/registry';

export interface LedgerTotals {
	total_sessions: number;
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
	total_commits: number;
	/** git_events with link_method='git_notes' (ADR-0004) — deterministic commit->session linkage vs. the time-window fallback for the rest of total_commits. */
	deterministic_commits: number;
	/** Subscription-amortized total (DESIGN.md rule 1's honest second number) — sum of covered amortized cost across all interactive sessions, all time. Never summed with total_cost/estimated_cost. */
	amortized_cost: number;
	/** True when at least one subscription_plans row exists — gates the empty state independent of whether any given month happened to be covered. */
	amortization_configured: boolean;
	/** Interactive (subscription-attributed) sessions whose (provider, month) had a covering plan. */
	amortized_covered_sessions: number;
	/** All interactive sessions considered for amortization (covered + uncovered). */
	amortized_interactive_sessions: number;
	/**
	 * All-time sum of `provider_costs.amount_usd` (slice 3) — REAL spend from
	 * provider cost APIs, daily-aggregate grain, never attributed to a unit
	 * of work (see `providerBuckets` on LedgerData). Money semantics: this
	 * MAY sum with `amortized_cost` into `actual_spend`; it must NEVER sum
	 * with `total_cost`/`estimated_cost` (those are API-equivalent *value*,
	 * not spend).
	 */
	provider_metered_cost: number;
	/**
	 * `amortized_cost` (when configured) + `provider_metered_cost` — "what
	 * the operator actually paid," the second REAL-spend family alongside
	 * `estimated`. When amortization is unconfigured this is the
	 * API-metered portion only, not a complete actual-spend figure — callers
	 * must pair it with `amortization_configured` to render that honestly
	 * (never silently treat "unconfigured" as "$0 subscription spend").
	 */
	actual_spend: number;
}

export interface ProviderBucketRow extends ProviderCostTotal {
	kind: 'provider-bucket';
	last_sync_status: SyncStatus;
	last_sync_at: string | null;
	last_sync_error: string | null;
}

export interface UnitOfWorkRow {
	unit_id: string;
	kind: 'initiative' | 'project' | 'session';
	name: string;
	project_path: string;
	session_count: number;
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
	commit_count: number;
	/** git_events with link_method='git_notes' for this unit — the deterministic subset of commit_count. */
	deterministic_commit_count: number;
	first_session_at: string | null;
	last_session_at: string | null;
	amortized_cost: number;
	amortized_covered_sessions: number;
	amortized_interactive_sessions: number;
}

export interface LedgerData {
	totals: LedgerTotals;
	units: UnitOfWorkRow[];
	/** API-metered spend, one row per known provider (connected or not — DESIGN.md rule 7), never folded into `units`. */
	providerBuckets: ProviderBucketRow[];
}

const EMPTY_TOTALS: LedgerTotals = {
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
};

const PROVENANCE_SUM = (col: string, provenance: string) =>
	`COALESCE(SUM(CASE WHEN ${col} = '${provenance}' THEN total_cost ELSE 0 END), 0)`;

type BaseTotals = Omit<
	LedgerTotals,
	| 'amortized_cost'
	| 'amortization_configured'
	| 'amortized_covered_sessions'
	| 'amortized_interactive_sessions'
	| 'provider_metered_cost'
	| 'actual_spend'
>;
type BaseUnitRow = Omit<
	UnitOfWorkRow,
	'amortized_cost' | 'amortized_covered_sessions' | 'amortized_interactive_sessions'
>;

async function getLedgerTotals(db: D1Database): Promise<BaseTotals> {
	const totalsRow = await db
		.prepare(
			`SELECT
				COUNT(*) AS total_sessions,
				COALESCE(SUM(total_cost), 0) AS total_cost,
				${PROVENANCE_SUM('cost_provenance', 'api_metered')} AS metered_cost,
				${PROVENANCE_SUM('cost_provenance', 'estimated')} AS estimated_cost,
				${PROVENANCE_SUM('cost_provenance', 'subscription_amortized')} AS subscription_cost
			 FROM sessions`
		)
		.first<Omit<BaseTotals, 'total_commits'>>();

	const commitsRow = await db
		.prepare(
			`SELECT
				COUNT(*) AS total_commits,
				COALESCE(SUM(CASE WHEN link_method = 'git_notes' THEN 1 ELSE 0 END), 0) AS deterministic_commits
			 FROM git_events`
		)
		.first<{ total_commits: number; deterministic_commits: number }>();

	return {
		...(totalsRow ?? {
			total_sessions: 0,
			total_cost: 0,
			metered_cost: 0,
			estimated_cost: 0,
			subscription_cost: 0
		}),
		total_commits: commitsRow?.total_commits ?? 0,
		deterministic_commits: commitsRow?.deterministic_commits ?? 0
	};
}

async function getUnitOfWorkLedger(db: D1Database): Promise<BaseUnitRow[]> {
	const { results } = await db
		.prepare(
			`SELECT
				u.id AS unit_id,
				u.kind AS kind,
				u.name AS name,
				u.project_path AS project_path,
				COUNT(s.id) AS session_count,
				COALESCE(SUM(s.total_cost), 0) AS total_cost,
				COALESCE(SUM(CASE WHEN s.cost_provenance = 'api_metered' THEN s.total_cost ELSE 0 END), 0) AS metered_cost,
				COALESCE(SUM(CASE WHEN s.cost_provenance = 'estimated' THEN s.total_cost ELSE 0 END), 0) AS estimated_cost,
				COALESCE(SUM(CASE WHEN s.cost_provenance = 'subscription_amortized' THEN s.total_cost ELSE 0 END), 0) AS subscription_cost,
				(SELECT COUNT(*) FROM git_events g WHERE g.unit_id = u.id) AS commit_count,
				(SELECT COUNT(*) FROM git_events g WHERE g.unit_id = u.id AND g.link_method = 'git_notes') AS deterministic_commit_count,
				MIN(s.started_at) AS first_session_at,
				MAX(s.ended_at) AS last_session_at
			 FROM units_of_work u
			 LEFT JOIN sessions s ON s.unit_id = u.id
			 GROUP BY u.id, u.kind, u.name, u.project_path
			 ORDER BY total_cost DESC`
		)
		.all<BaseUnitRow>();
	return results;
}

/**
 * One row per known provider (DESIGN.md rule 7: "not connected" renders
 * honestly, never as an absent/empty chart) — `ALL_PROVIDERS` is the
 * canonical list, left-joined against whatever `provider_costs`/
 * `provider_sync_state` rows exist so a provider with zero syncs still
 * shows up as "not connected" or "never run" instead of disappearing.
 */
async function loadProviderBuckets(db: D1Database): Promise<ProviderBucketRow[]> {
	const [totals, states] = await Promise.all([providerCostTotals(db), allSyncStates(db)]);
	const totalsByProvider = new Map(totals.map((t) => [t.provider, t]));
	const stateByProvider = new Map(states.map((s) => [s.provider, s]));

	return ALL_PROVIDERS.map((provider): ProviderBucketRow => {
		const total = totalsByProvider.get(provider.name);
		const state: ProviderSyncStateRow | undefined = stateByProvider.get(provider.name);
		return {
			provider: provider.name,
			total_amount_usd: total?.total_amount_usd ?? 0,
			days_covered: total?.days_covered ?? 0,
			earliest_date: total?.earliest_date ?? null,
			latest_date: total?.latest_date ?? null,
			kind: 'provider-bucket',
			last_sync_status: state?.last_sync_status ?? 'never_run',
			last_sync_at: state?.last_sync_at ?? null,
			last_sync_error: state?.last_sync_error ?? null
		};
	});
}

export async function loadLedgerData(db: D1Database): Promise<LedgerData> {
	const [baseTotals, baseUnits, plans, providerMeteredCost, providerBuckets] = await Promise.all([
		getLedgerTotals(db),
		getUnitOfWorkLedger(db),
		listSubscriptionPlans(db),
		providerCostGrandTotal(db),
		loadProviderBuckets(db)
	]);

	// All-time rollup (sinceIso: null) — the ledger prices the whole practice,
	// not a window (that's practice-numbers' job).
	const rollup = await computeAmortizationRollup(db, plans, null);
	const amortizationConfigured = plans.length > 0;

	const totals: LedgerTotals = {
		...(baseTotals ?? EMPTY_TOTALS),
		amortized_cost: rollup.totals.amortizedCostUsd,
		amortization_configured: amortizationConfigured,
		amortized_covered_sessions: rollup.totals.coveredSessions,
		amortized_interactive_sessions: rollup.totals.totalInteractiveSessions,
		provider_metered_cost: providerMeteredCost,
		// Money semantics (extends DP-1): amortized + api_metered are both
		// REAL spend and MAY sum; `estimated` never joins this sum (see
		// LedgerTotals.actual_spend doc comment).
		actual_spend: (amortizationConfigured ? rollup.totals.amortizedCostUsd : 0) + providerMeteredCost
	};

	const units: UnitOfWorkRow[] = baseUnits.map((unit) => {
		const summary = rollup.perUnit.get(unit.unit_id);
		return {
			...unit,
			amortized_cost: summary?.amortizedCostUsd ?? 0,
			amortized_covered_sessions: summary?.coveredSessions ?? 0,
			amortized_interactive_sessions: summary?.totalInteractiveSessions ?? 0
		};
	});

	return { totals, units, providerBuckets };
}
