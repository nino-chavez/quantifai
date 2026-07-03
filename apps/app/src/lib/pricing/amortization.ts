/**
 * Subscription amortization — the honest second number (DESIGN.md rule 1).
 *
 * `anthropic-pricing.ts` answers "what would these tokens have cost on
 * pay-as-you-go API pricing" (`estimated`). This module answers a different
 * question: "of the flat monthly fee the operator actually pays for a
 * subscription plan, how much of it does THIS unit of work / session
 * represent" (`subscription_amortized`). The two are never summed — see
 * every caller.
 *
 * Method (documented once here, referenced everywhere else):
 *   1. For each calendar month, find the subscription plan(s) active for a
 *      given provider during that month. A plan changing mid-month (new
 *      fee, cancelled, etc.) is prorated by the number of days it overlaps
 *      the month, out of the days in the month — so a plan that started on
 *      day 16 of a 31-day month contributes ~16/31 of its monthly fee to
 *      that month's pool, not the full fee.
 *   2. That month's total fee (summed across any overlapping plan segments)
 *      is spread across that provider's subscription-attributed usage
 *      buckets for the month by **usage share** — each bucket's share of
 *      `input_tokens + output_tokens` summed across all buckets in the
 *      (provider, month) group. Output tokens dominate cost on pay-as-you-go
 *      pricing and are the most defensible single proxy for "how much of
 *      this session's real work" without introducing a second pricing
 *      table just for the amortized view; documented here rather than
 *      silently assumed.
 *   3. A (provider, month) group with no covering plan produces `covered:
 *      false` buckets at $0 — never a guessed fee. Callers surface that as
 *      the "amortization unconfigured" empty state, not a bare zero.
 *
 * Caller responsibility: only pass buckets for subscription-attributed
 * usage (`sessions.source = 'interactive'`) — API-metered usage (future
 * `api_metered` provenance) is never amortized against a subscription fee,
 * per ADR the ingest schema's `source` enum encodes. This module has no
 * opinion on that filter; it operates on whatever buckets it's given.
 */

export interface SubscriptionPlan {
	provider: string;
	monthlyFeeUsd: number;
	/** ISO date (YYYY-MM-DD) or full ISO timestamp — the day the plan became active. */
	activeFrom: string;
	/** ISO date/timestamp of the plan's last active day (inclusive), or null if still active. */
	activeTo: string | null;
}

/**
 * One grouping key's usage for one calendar month — the unit the caller
 * wants an amortized figure for (a session, a unit-of-work, whatever `key`
 * means to the caller). `sessionCount` is a pure passthrough (unused by the
 * math, returned unchanged) so callers can report coverage ("N of M
 * sessions") without a second pass over the source rows.
 */
export interface UsageBucket {
	key: string;
	provider: string;
	/** Calendar month, UTC, `YYYY-MM`. */
	month: string;
	usageTokens: number;
	sessionCount: number;
}

export interface AmortizedBucket {
	key: string;
	provider: string;
	month: string;
	amortizedCostUsd: number;
	/** false when no subscription plan covered this (provider, month) — amortizedCostUsd is 0, not a guess. */
	covered: boolean;
	sessionCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function monthRange(month: string): { start: number; end: number; days: number } {
	const [year, m] = month.split('-').map(Number);
	const start = Date.UTC(year, m - 1, 1);
	const end = Date.UTC(year, m, 1); // exclusive
	return { start, end, days: (end - start) / DAY_MS };
}

/**
 * Total plan fee attributable to one (provider, month), prorated across any
 * plan segment(s) that overlap the month. `activeTo` is treated as an
 * inclusive end-of-day boundary (a plan cancelled effective 2026-01-15 still
 * covers all of the 15th).
 */
function planFeeForMonth(provider: string, month: string, plans: SubscriptionPlan[]): number {
	const { start: monthStart, end: monthEnd, days: daysInMonth } = monthRange(month);

	let fee = 0;
	for (const plan of plans) {
		if (plan.provider !== provider) continue;

		const planFrom = Date.parse(plan.activeFrom);
		if (Number.isNaN(planFrom)) continue; // malformed row — skip, never guess

		const planToRaw = plan.activeTo ? Date.parse(plan.activeTo) : NaN;
		const planTo = plan.activeTo && !Number.isNaN(planToRaw) ? planToRaw + DAY_MS : Infinity;

		const overlapStart = Math.max(monthStart, planFrom);
		const overlapEnd = Math.min(monthEnd, planTo);
		const overlapDays = Math.max(0, (overlapEnd - overlapStart) / DAY_MS);

		if (overlapDays > 0) {
			fee += plan.monthlyFeeUsd * (overlapDays / daysInMonth);
		}
	}
	return fee;
}

/**
 * Spreads each (provider, month)'s plan fee across its usage buckets by
 * usage share. Buckets that all have zero usage tokens (e.g. a session with
 * no recorded token counts) split the fee evenly rather than divide by zero.
 */
export function amortizeByUsageShare(
	buckets: UsageBucket[],
	plans: SubscriptionPlan[]
): AmortizedBucket[] {
	const groups = new Map<string, UsageBucket[]>();
	for (const bucket of buckets) {
		const groupKey = `${bucket.provider}::${bucket.month}`;
		const list = groups.get(groupKey) ?? [];
		list.push(bucket);
		groups.set(groupKey, list);
	}

	const out: AmortizedBucket[] = [];
	for (const group of groups.values()) {
		const { provider, month } = group[0];
		const monthFee = planFeeForMonth(provider, month, plans);

		if (monthFee <= 0) {
			for (const bucket of group) {
				out.push({
					key: bucket.key,
					provider,
					month,
					amortizedCostUsd: 0,
					covered: false,
					sessionCount: bucket.sessionCount
				});
			}
			continue;
		}

		const totalUsage = group.reduce((sum, b) => sum + b.usageTokens, 0);
		for (const bucket of group) {
			const share = totalUsage > 0 ? bucket.usageTokens / totalUsage : 1 / group.length;
			out.push({
				key: bucket.key,
				provider,
				month,
				amortizedCostUsd: monthFee * share,
				covered: true,
				sessionCount: bucket.sessionCount
			});
		}
	}
	return out;
}
