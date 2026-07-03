/**
 * D1-to-amortization glue, shared by the ledger (all-time) and
 * practice-numbers (windowed) pages. Pulls usage buckets grouped by
 * (unit, provider, calendar month) for subscription-attributed
 * (`source = 'interactive'`) sessions only — API-metered usage is out of
 * scope for amortization by construction (the SQL WHERE clause is the
 * "caller responsibility" src/lib/pricing/amortization.ts's header
 * describes), then runs the pure usage-share math and re-aggregates back up
 * to per-unit and practice-wide summaries.
 *
 * A session with no `unit_id` (a repo scanned before any Claude Code session
 * gave it a unit) groups under the `__unassigned__` sentinel key — it still
 * counts toward practice-wide totals, just has no unit row to attach to
 * (mirrors the existing ledger behavior for cost/session totals).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { amortizeByUsageShare, type SubscriptionPlan, type UsageBucket } from '../pricing/amortization';

export const UNASSIGNED_UNIT_KEY = '__unassigned__';

export interface UnitAmortizationSummary {
	amortizedCostUsd: number;
	coveredSessions: number;
	totalInteractiveSessions: number;
}

export interface AmortizationRollup {
	perUnit: Map<string, UnitAmortizationSummary>;
	totals: UnitAmortizationSummary;
}

function emptySummary(): UnitAmortizationSummary {
	return { amortizedCostUsd: 0, coveredSessions: 0, totalInteractiveSessions: 0 };
}

async function fetchUsageBuckets(db: D1Database, sinceIso: string | null): Promise<UsageBucket[]> {
	const { results } = await db
		.prepare(
			`SELECT
				COALESCE(unit_id, '${UNASSIGNED_UNIT_KEY}') AS key,
				provider,
				strftime('%Y-%m', started_at) AS month,
				SUM(input_tokens + output_tokens) AS usageTokens,
				COUNT(*) AS sessionCount
			 FROM sessions
			 WHERE source = 'interactive' AND started_at IS NOT NULL
			   AND (?1 IS NULL OR started_at >= ?1)
			 GROUP BY key, provider, month`
		)
		.bind(sinceIso)
		.all<UsageBucket>();
	return results;
}

/**
 * @param sinceIso ISO timestamp lower bound on `sessions.started_at`, or
 *   `null` for all-time (the ledger's usage).
 */
export async function computeAmortizationRollup(
	db: D1Database,
	plans: SubscriptionPlan[],
	sinceIso: string | null
): Promise<AmortizationRollup> {
	const buckets = await fetchUsageBuckets(db, sinceIso);
	const amortized = amortizeByUsageShare(buckets, plans);

	const perUnit = new Map<string, UnitAmortizationSummary>();
	const totals = emptySummary();

	for (const bucket of amortized) {
		const cur = perUnit.get(bucket.key) ?? emptySummary();
		cur.totalInteractiveSessions += bucket.sessionCount;
		totals.totalInteractiveSessions += bucket.sessionCount;
		if (bucket.covered) {
			cur.amortizedCostUsd += bucket.amortizedCostUsd;
			cur.coveredSessions += bucket.sessionCount;
			totals.amortizedCostUsd += bucket.amortizedCostUsd;
			totals.coveredSessions += bucket.sessionCount;
		}
		perUnit.set(bucket.key, cur);
	}

	return { perUnit, totals };
}

export type { SubscriptionPlan };
