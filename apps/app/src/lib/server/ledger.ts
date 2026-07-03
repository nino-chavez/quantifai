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

export interface LedgerTotals {
	total_sessions: number;
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
	total_commits: number;
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
	total_commits: 0
};

const PROVENANCE_SUM = (col: string, provenance: string) =>
	`COALESCE(SUM(CASE WHEN ${col} = '${provenance}' THEN total_cost ELSE 0 END), 0)`;

async function getLedgerTotals(db: D1Database): Promise<LedgerTotals> {
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
		.first<Omit<LedgerTotals, 'total_commits'>>();

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

async function getUnitOfWorkLedger(db: D1Database): Promise<UnitOfWorkRow[]> {
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
		.all<UnitOfWorkRow>();
	return results;
}

export async function loadLedgerData(db: D1Database): Promise<LedgerData> {
	const [totals, units] = await Promise.all([getLedgerTotals(db), getUnitOfWorkLedger(db)]);
	return { totals: totals ?? EMPTY_TOTALS, units };
}
