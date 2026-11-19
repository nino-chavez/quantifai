/**
 * OpenRouter cost poller — daily activity + lifetime-remainder.
 *
 * `GET /api/v1/activity` (undocumented in OpenRouter's published API
 * reference as of 2026-07-03 — the docs site's `/docs/api-reference/*`
 * paths 404 and the cookbook pages only describe the *web UI*'s Activity
 * export, not this JSON endpoint) is the real day-bucketed cost source:
 * verified live against the operator's real Management API key
 * (`OpenRouter Management API Key - quantifai`, 1Password) on 2026-07-03.
 * It returns one row per (date, model, endpoint) with a `usage` field in
 * USD (not credits — OpenRouter credits are 1:1 with USD), covering only
 * the **last 30 *completed* UTC days**: querying `?date=` for anything
 * older 400s with `"Date must be within the last 30 (completed) UTC
 * days"`, and querying today's (incomplete) UTC day 400s the same way. The
 * no-param call already returns the full available window in one shot —
 * no pagination needed.
 *
 * `byok_usage_inference` is a SEPARATE additive spend component, not
 * already folded into `usage`: the web UI's activity-export cookbook page
 * describes the "Spend" metric it's sourced from as "Total spend
 * (OpenRouter credits + estimated BYOK spend)" — two summands, not one
 * inclusive of the other. This adapter sums `usage + byok_usage_inference`
 * per row so a future BYOK-routed model's spend isn't silently dropped
 * (today's live data has `byok_usage_inference: 0` on every row, so this
 * doesn't change the numbers yet, but the summation is load-bearing once
 * BYOK is used).
 *
 * Lifetime honesty: the activity window can't reach the operator's full
 * account history (`/credits`' `total_usage`, cumulative since account
 * creation, was $129.98 live on 2026-07-03 vs. ~$29.47 summed across the
 * entire 30-day activity window) — the gap is real pre-window spend, not
 * an accounting error. Rather than silently truncating history to what
 * `/activity` can see, this adapter also fetches `/credits` and emits ONE
 * remainder row — `total_usage - sum(activity days)` — dated with sentinel
 * `2025-01-01` (this project's `FULL_BACKFILL_START_ISO`, see
 * sync-providers.ts) and `workspaceOrKey: 'org-historical'` (distinct from
 * the daily rows' `'org'`, so the UNIQUE (provider, date, workspace_or_key)
 * upsert never collides the two). Recomputed fresh on every sync. A day that
 * ages out of the 30-day window keeps its own stored daily row, so the
 * remainder is lifetime usage minus EVERY stored daily row: the current
 * window's, plus the stored days the window no longer shows (the orchestrator
 * passes this provider's stored rows in). That keeps the provider's total in
 * `provider_costs` equal to its lifetime usage, and keeps aged-out days in
 * the 90-day view. Before quantifai#11 the remainder subtracted only the
 * window, so each aged-out day was counted twice. Skipped when it would be
 * ≤ 0 and none is stored yet; when one is stored, it is overwritten with $0
 * rather than left stale.
 *
 * `fetchWindow`'s `window` argument is intentionally unused: neither
 * OpenRouter endpoint here supports an arbitrary since/until range (only a
 * single `?date=` day filter, which isn't useful for a window read) — each
 * sync just re-pulls "the current 30-day activity snapshot + current
 * lifetime total," and the `provider_costs` upsert (replace-not-accumulate
 * on conflict, src/lib/server/provider-costs.ts) makes that idempotent.
 *
 * Migration 0005 deletes the prior single-snapshot row this adapter used
 * to write (`openrouter, <today>, 'org'`, the full lifetime total) — left
 * in place it would double-count against these new daily + remainder rows.
 */

import { z } from 'zod';
import type { CostProvider, FetchWindow, ProviderCostRow, ProviderSyncEnv, StoredCostRow } from './types';

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
export const OPENROUTER_ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity';

/** Sentinel date for the pre-activity-window remainder row — this project's full-backfill start (sync-providers.ts's `FULL_BACKFILL_START_ISO`), reused here as "everything before the activity window began." */
export const HISTORICAL_REMAINDER_DATE = '2025-01-01';
export const HISTORICAL_REMAINDER_WORKSPACE = 'org-historical';

const creditsResponseSchema = z.object({
	data: z.object({
		total_credits: z.number(),
		total_usage: z.number()
	})
});

export type OpenRouterCreditsResponse = z.infer<typeof creditsResponseSchema>;

const activityRowSchema = z.object({
	date: z.string(), // "YYYY-MM-DD 00:00:00" — always UTC midnight, per live verification
	usage: z.number(),
	byok_usage_inference: z.number().optional().default(0)
});

const activityResponseSchema = z.object({
	data: z.array(activityRowSchema)
});

export type OpenRouterActivityResponse = z.infer<typeof activityResponseSchema>;

/** First 10 chars of "YYYY-MM-DD 00:00:00" — a straight slice is exact since the API always returns UTC-midnight-stamped dates. */
function isoDateOnly(activityDate: string): string {
	return activityDate.slice(0, 10);
}

/** Aggregates `/activity`'s per-(date, model, endpoint) rows into one `provider_costs` row per calendar date, summing `usage + byok_usage_inference` (two additive spend components — see module header) defensively rather than assuming one row per date. */
export function normalizeOpenRouterActivity(response: OpenRouterActivityResponse): ProviderCostRow[] {
	const byDate = new Map<string, ProviderCostRow>();

	for (const row of response.data) {
		const date = isoDateOnly(row.date);
		const amount = row.usage + (row.byok_usage_inference ?? 0);

		const existing = byDate.get(date);
		if (existing) {
			existing.amountUsd += amount;
		} else {
			byDate.set(date, {
				provider: 'openrouter',
				date,
				workspaceOrKey: 'org',
				amountUsd: amount,
				currency: 'USD',
				raw: row
			});
		}
	}

	return Array.from(byDate.values());
}

/**
 * The remainder no daily row accounts for: lifetime `total_usage` minus the
 * activity rows, minus every stored daily row the activity window no longer
 * covers (days that aged out keep their own rows). Returns `null` (skip,
 * don't write a zero/negative row) when daily rows already cover the
 * lifetime total and no remainder is stored; a stored one is overwritten
 * with $0 so it can't stay stale.
 */
export function computeHistoricalRemainder(
	totalUsage: number,
	activityRows: ProviderCostRow[],
	stored: StoredCostRow[] = []
): ProviderCostRow | null {
	const activitySum = activityRows.reduce((sum, row) => sum + row.amountUsd, 0);
	const windowDates = new Set(activityRows.map((row) => row.date));
	const agedOutStoredSum = stored
		.filter((row) => row.workspaceOrKey === 'org' && !windowDates.has(row.date))
		.reduce((sum, row) => sum + row.amountUsd, 0);
	const remainder = totalUsage - activitySum - agedOutStoredSum;
	const remainderStored = stored.some((row) => row.workspaceOrKey === HISTORICAL_REMAINDER_WORKSPACE);
	if (remainder <= 0 && !remainderStored) return null;

	return {
		provider: 'openrouter',
		date: HISTORICAL_REMAINDER_DATE,
		workspaceOrKey: HISTORICAL_REMAINDER_WORKSPACE,
		amountUsd: Math.max(0, remainder),
		currency: 'USD',
		raw: {
			derivation: 'remainder: /credits total_usage minus the /activity sum minus stored daily rows outside the window',
			total_usage: totalUsage,
			activity_sum: activitySum,
			aged_out_stored_sum: agedOutStoredSum
		}
	};
}

async function fetchCredits(apiKey: string): Promise<OpenRouterCreditsResponse> {
	const response = await fetch(OPENROUTER_CREDITS_URL, {
		headers: { authorization: `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenRouter credits ${response.status}: ${body.slice(0, 500)}`);
	}

	return creditsResponseSchema.parse(await response.json());
}

async function fetchActivity(apiKey: string): Promise<OpenRouterActivityResponse> {
	const response = await fetch(OPENROUTER_ACTIVITY_URL, {
		headers: { authorization: `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenRouter activity ${response.status}: ${body.slice(0, 500)}`);
	}

	return activityResponseSchema.parse(await response.json());
}

export const openrouterProvider: CostProvider = {
	name: 'openrouter',

	isConnected(env: ProviderSyncEnv): boolean {
		return Boolean(env.OPENROUTER_API_KEY);
	},

	async fetchWindow(_window: FetchWindow, env: ProviderSyncEnv, stored: StoredCostRow[] = []): Promise<ProviderCostRow[]> {
		const apiKey = env.OPENROUTER_API_KEY;
		if (!apiKey) throw new Error('openrouterProvider.fetchWindow called without OPENROUTER_API_KEY');

		const [activity, credits] = await Promise.all([fetchActivity(apiKey), fetchCredits(apiKey)]);

		const dailyRows = normalizeOpenRouterActivity(activity);
		const remainderRow = computeHistoricalRemainder(credits.data.total_usage, dailyRows, stored);

		return remainderRow ? [...dailyRows, remainderRow] : dailyRows;
	}
};
