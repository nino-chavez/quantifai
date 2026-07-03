/**
 * Anthropic cost poller — Admin API Cost Report
 * (`GET /v1/organizations/cost_report`, current docs as of 2026-07-03:
 * https://platform.claude.com/docs/en/api/admin/cost_report).
 *
 * Supersedes quantifai-lite's `usage_report/messages` poller (sibling scan,
 * `research/current-state/sibling-project-scan.md`): that endpoint returns
 * no cost, so lite hand-rolled a per-model pricing table to derive one. The
 * Cost Report endpoint returns USD amounts directly — no pricing table, no
 * staleness risk when Anthropic changes prices.
 *
 * Auth: `x-api-key: $ANTHROPIC_ADMIN_API_KEY` + `anthropic-version:
 * 2023-06-01` (Admin API keys, `sk-ant-admin01-...`, are a distinct
 * credential from Messages API keys and use the same header shape).
 *
 * Grain: `bucket_width=1d` + `group_by[]=workspace_id` gives one row per
 * workspace per UTC day (or one row with `workspace_id: null` -> sentinel
 * 'org' for usage not attributed to a workspace) — exactly the
 * `provider_costs` grain. `group_by[]=description` is deliberately NOT
 * requested: a model/token-type breakdown is out of scope for this slice
 * (daily-aggregate, not itemized) and would multiply row count for no
 * surfaced benefit.
 *
 * `amount` units — VERIFIED LIVE 2026-07-03, overriding the task brief's
 * "Cost API returns USD directly": the field docs literally say "Cost
 * amount in lowest currency units (e.g. cents)... '123.45' in 'USD'
 * represents $1.23" and a live backfill against the operator's real account
 * confirms it — an undivided read produced $41,545 total for a 63-day
 * window, ~100x every plausible reading of the operator's actual Sep-Dec
 * 2025 invoices (~$20-182/mo, i.e. ~$0.66-6/day); dividing by 100 produced
 * $415.46 for the same window (~$6.59/day), squarely inside that range.
 * `amountUsd` below is therefore `parseFloat(amount) / 100`.
 */

import { z } from 'zod';
import type { CostProvider, FetchWindow, ProviderCostRow, ProviderSyncEnv } from './types';

export const ANTHROPIC_COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
export const ANTHROPIC_API_VERSION = '2023-06-01';
const PAGE_LIMIT = 31; // ~one month of daily buckets per page
const MAX_PAGES = 240; // safety cap (~20 years of monthly pages) — a real loop bug fails loud, not silent/infinite

const costResultSchema = z.object({
	amount: z.string(),
	currency: z.string(),
	workspace_id: z.string().nullable().optional()
});

const costBucketSchema = z.object({
	starting_at: z.string(),
	ending_at: z.string(),
	results: z.array(costResultSchema)
});

const costReportSchema = z.object({
	data: z.array(costBucketSchema),
	has_more: z.boolean(),
	next_page: z.string().nullable().optional()
});

export type CostReport = z.infer<typeof costReportSchema>;

/** UTC calendar day from an RFC 3339 timestamp — `bucket_width=1d` guarantees `starting_at` is UTC midnight, so a straight slice is exact. */
function isoDateOnly(rfc3339: string): string {
	return rfc3339.slice(0, 10);
}

/** Start of the UTC day containing this timestamp, as epoch ms. */
function utcDayFloor(iso: string): number {
	const d = new Date(iso);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * `bucket_width=1d` only ever returns COMPLETE UTC-day buckets — today (an
 * in-progress day) can never be one. Verified live 2026-07-03: requesting a
 * window whose `starting_at` snaps to today's boundary (i.e. `sinceIso` is
 * already within today, e.g. a same-day manual re-sync minutes after a
 * prior success) gets a 400 "ending date must be after starting date," not
 * an empty 200 — there is no valid complete-day bucket in that range. This
 * is a legitimate "nothing new yet" case, not a transport failure, so it
 * short-circuits to an empty result rather than calling the API.
 */
export function hasNoCompleteDayToFetch(sinceIso: string, now: Date): boolean {
	return utcDayFloor(sinceIso) >= utcDayFloor(now.toISOString());
}

/**
 * Normalizes one page's buckets into `provider_costs` rows. Sums amounts
 * defensively by (date, workspace) rather than assuming exactly one result
 * per bucket per workspace — boundary parsing (invariant 1) means this
 * adapter, not any downstream caller, absorbs a shape it didn't expect.
 */
export function normalizeCostReport(report: CostReport): ProviderCostRow[] {
	const byKey = new Map<string, ProviderCostRow>();

	for (const bucket of report.data) {
		const date = isoDateOnly(bucket.starting_at);
		for (const result of bucket.results) {
			const workspaceOrKey = result.workspace_id ?? 'org';
			const key = `${date}::${workspaceOrKey}`;
			// Lowest-currency-units (cents) -> USD; see the module header's
			// live-verification note.
			const amount = Number.parseFloat(result.amount) / 100;
			if (Number.isNaN(amount)) continue; // malformed row — skip, never guess (mirrors amortization.ts's rule)

			const existing = byKey.get(key);
			if (existing) {
				existing.amountUsd += amount;
			} else {
				byKey.set(key, {
					provider: 'anthropic',
					date,
					workspaceOrKey,
					amountUsd: amount,
					currency: result.currency,
					raw: bucket
				});
			}
		}
	}

	return Array.from(byKey.values());
}

async function fetchPage(
	apiKey: string,
	window: FetchWindow,
	page: string | undefined
): Promise<CostReport> {
	const url = new URL(ANTHROPIC_COST_REPORT_URL);
	// Floor to the UTC day boundary before sending: the API snaps
	// `starting_at` to a bucket boundary itself, but an unsnapped
	// mid-day value was observed live (2026-07-03) to trigger "ending date
	// must be after starting date" even on a multi-day-old `sinceIso` with
	// no `ending_at` supplied at all — sending an already-snapped boundary
	// sidesteps whatever internal rounding direction produced that.
	url.searchParams.set('starting_at', new Date(utcDayFloor(window.sinceIso)).toISOString());
	if (window.untilIso) url.searchParams.set('ending_at', window.untilIso);
	url.searchParams.set('bucket_width', '1d');
	// Verified live 2026-07-03 against the real Cost Report API: a bare
	// `group_by` is rejected with "Use `group_by[]` for array parameters."
	url.searchParams.append('group_by[]', 'workspace_id');
	url.searchParams.set('limit', String(PAGE_LIMIT));
	if (page) url.searchParams.set('page', page);

	const response = await fetch(url, {
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': ANTHROPIC_API_VERSION
		}
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Anthropic cost_report ${response.status}: ${body.slice(0, 500)}`);
	}

	return costReportSchema.parse(await response.json());
}

export const anthropicProvider: CostProvider = {
	name: 'anthropic',

	isConnected(env: ProviderSyncEnv): boolean {
		return Boolean(env.ANTHROPIC_ADMIN_API_KEY);
	},

	async fetchWindow(window: FetchWindow, env: ProviderSyncEnv): Promise<ProviderCostRow[]> {
		const apiKey = env.ANTHROPIC_ADMIN_API_KEY;
		if (!apiKey) throw new Error('anthropicProvider.fetchWindow called without ANTHROPIC_ADMIN_API_KEY');

		if (hasNoCompleteDayToFetch(window.sinceIso, new Date())) return [];

		const rows: ProviderCostRow[] = [];
		let page: string | undefined;
		let pageCount = 0;

		do {
			const report = await fetchPage(apiKey, window, page);
			rows.push(...normalizeCostReport(report));
			page = report.has_more ? (report.next_page ?? undefined) : undefined;
			pageCount += 1;
			if (pageCount >= MAX_PAGES) {
				throw new Error(`Anthropic cost_report: exceeded ${MAX_PAGES} pages — pagination loop suspected`);
			}
		} while (page);

		return rows;
	}
};
