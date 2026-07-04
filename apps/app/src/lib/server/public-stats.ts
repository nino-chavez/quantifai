/**
 * Grand-total aggregates for the PUBLIC landing page's live proof strip and
 * `GET /api/v1/public-stats` — deliberately the only data this instance
 * exposes outside the Access-gated ledger. No project/unit names, no
 * per-provider breakdown: a client-adjacent surface must never leak which
 * initiatives or projects the operator is pricing (DESIGN.md posture
 * extended to the public landing — the retired build's over-claim failure
 * was about naming things that didn't exist; this guards the opposite
 * failure, naming things that DO exist but are private).
 *
 * Money semantics mirror src/lib/server/ledger.ts exactly: `estimatedValueUsd`
 * (API-equivalent) and `actualSpendUsd` (amortized + api_metered) are two
 * separate families that must never be summed together.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { computeAmortizationRollup } from './amortization-query';
import { listSubscriptionPlans } from './subscription-plans';
import { providerCostGrandTotal } from './provider-costs';

export interface PublicStats {
	/** All-time SUM(sessions.total_cost) — API-equivalent value, never actual spend. */
	estimatedValueUsd: number;
	/** Amortized subscription cost (when configured) + all-time API-metered spend — real dollars paid. */
	actualSpendUsd: number;
	sessionCount: number;
	unitCount: number;
	/** git_events linked via git notes (ADR-0004) — the deterministic subset, not total commit count. */
	deterministicCommitCount: number;
	/** ISO timestamp of the most recent activity across sessions/provider-cost syncs/git commits, or null if this instance has no data yet. */
	lastUpdated: string | null;
}

const EMPTY_STATS: PublicStats = {
	estimatedValueUsd: 0,
	actualSpendUsd: 0,
	sessionCount: 0,
	unitCount: 0,
	deterministicCommitCount: 0,
	lastUpdated: null
};

export async function getPublicStats(db: D1Database): Promise<PublicStats> {
	const [sessionRow, unitRow, commitRow, lastUpdatedRow, plans, providerMeteredCost] = await Promise.all([
		db
			.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cost), 0) AS total FROM sessions`)
			.first<{ count: number; total: number }>(),
		db.prepare(`SELECT COUNT(*) AS count FROM units_of_work`).first<{ count: number }>(),
		db
			.prepare(`SELECT COUNT(*) AS count FROM git_events WHERE link_method = 'git_notes'`)
			.first<{ count: number }>(),
		db
			.prepare(
				`SELECT MAX(x) AS last_updated FROM (
					SELECT MAX(ended_at) AS x FROM sessions
					UNION ALL SELECT MAX(date) AS x FROM provider_costs
					UNION ALL SELECT MAX(authored_at) AS x FROM git_events
				 )`
			)
			.first<{ last_updated: string | null }>(),
		listSubscriptionPlans(db),
		providerCostGrandTotal(db)
	]);

	const amortizationConfigured = plans.length > 0;
	const rollup = amortizationConfigured ? await computeAmortizationRollup(db, plans, null) : null;
	const amortizedCost = rollup?.totals.amortizedCostUsd ?? 0;

	return {
		estimatedValueUsd: sessionRow?.total ?? EMPTY_STATS.estimatedValueUsd,
		actualSpendUsd: amortizedCost + providerMeteredCost,
		sessionCount: sessionRow?.count ?? EMPTY_STATS.sessionCount,
		unitCount: unitRow?.count ?? EMPTY_STATS.unitCount,
		deterministicCommitCount: commitRow?.count ?? EMPTY_STATS.deterministicCommitCount,
		lastUpdated: lastUpdatedRow?.last_updated ?? EMPTY_STATS.lastUpdated
	};
}
