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

export interface LedgerTotals {
	total_sessions: number;
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
	total_commits: number;
	/** Subscription-amortized total (DESIGN.md rule 1's honest second number) — sum of covered amortized cost across all interactive sessions, all time. Never summed with total_cost/estimated_cost. */
	amortized_cost: number;
	/** True when at least one subscription_plans row exists — gates the empty state independent of whether any given month happened to be covered. */
	amortization_configured: boolean;
	/** Interactive (subscription-attributed) sessions whose (provider, month) had a covering plan. */
	amortized_covered_sessions: number;
	/** All interactive sessions considered for amortization (covered + uncovered). */
	amortized_interactive_sessions: number;
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
	first_session_at: string | null;
	last_session_at: string | null;
	amortized_cost: number;
	amortized_covered_sessions: number;
	amortized_interactive_sessions: number;
}

export interface LedgerData {
	totals: LedgerTotals;
	units: UnitOfWorkRow[];
}

const EMPTY_TOTALS: LedgerTotals = {
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
};

const PROVENANCE_SUM = (col: string, provenance: string) =>
	`COALESCE(SUM(CASE WHEN ${col} = '${provenance}' THEN total_cost ELSE 0 END), 0)`;

type BaseTotals = Omit<
	LedgerTotals,
	'amortized_cost' | 'amortization_configured' | 'amortized_covered_sessions' | 'amortized_interactive_sessions'
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
		.prepare(`SELECT COUNT(*) AS total_commits FROM git_events`)
		.first<{ total_commits: number }>();

	return {
		...(totalsRow ?? {
			total_sessions: 0,
			total_cost: 0,
			metered_cost: 0,
			estimated_cost: 0,
			subscription_cost: 0
		}),
		total_commits: commitsRow?.total_commits ?? 0
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

export async function loadLedgerData(db: D1Database): Promise<LedgerData> {
	const [baseTotals, baseUnits, plans] = await Promise.all([
		getLedgerTotals(db),
		getUnitOfWorkLedger(db),
		listSubscriptionPlans(db)
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
		amortized_interactive_sessions: rollup.totals.totalInteractiveSessions
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

	return { totals, units };
}
