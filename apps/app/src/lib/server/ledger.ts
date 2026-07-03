/**
 * Server-side data access for the unit-of-work ledger page. Calls the
 * Postgres RPC functions (never raw `.select()` past the default row cap —
 * the architectural invariant carried from quantifai-platform).
 */

import { createSupabaseAdminClient } from './db';

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

export async function loadLedgerData(): Promise<LedgerData> {
	const supabase = createSupabaseAdminClient();

	const [totalsRes, unitsRes] = await Promise.all([
		supabase.rpc('get_ledger_totals'),
		supabase.rpc('get_unit_of_work_ledger')
	]);

	if (totalsRes.error) throw new Error(`get_ledger_totals failed: ${totalsRes.error.message}`);
	if (unitsRes.error) throw new Error(`get_unit_of_work_ledger failed: ${unitsRes.error.message}`);

	// get_ledger_totals() is a single-row Postgres function; PostgREST still
	// wraps it in an array. Cast rather than fight supabase-js's RPC generics.
	const totalsRows = (totalsRes.data ?? []) as unknown as LedgerTotals[];

	return {
		totals: totalsRows[0] ?? EMPTY_TOTALS,
		units: (unitsRes.data ?? []) as unknown as UnitOfWorkRow[]
	};
}
