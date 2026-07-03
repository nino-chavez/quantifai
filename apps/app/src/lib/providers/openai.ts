/**
 * OpenAI cost poller — Admin API Costs endpoint
 * (`GET /v1/organization/costs`, current docs as of 2026-07-03:
 * https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).
 * Code-complete, matching the sibling scan's `quantifai-lite` poller shape
 * (`research/current-state/sibling-project-scan.md`) ported to this
 * provider's real endpoint — but DISABLED: `isConnected()` gates on
 * `env.OPENAI_ADMIN_API_KEY`, which no secret currently backs. The sync
 * orchestrator never calls `fetchWindow` while disconnected (DESIGN.md rule
 * 7: absent secret renders "not connected," never an error).
 *
 * Auth: `Authorization: Bearer $OPENAI_ADMIN_API_KEY` (an Admin API key,
 * `sk-admin-...`, distinct from a project API key).
 *
 * Grain: `bucket_width=1d` + `group_by=project_id` gives one row per
 * project per UTC day (or `project_id: null` -> sentinel 'org' for
 * unattributed usage) — same shape contract as the Anthropic adapter.
 */

import { z } from 'zod';
import type { CostProvider, FetchWindow, ProviderCostRow, ProviderSyncEnv } from './types';

export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const PAGE_LIMIT = 31;
const MAX_PAGES = 240;

const costResultSchema = z.object({
	amount: z.object({
		value: z.number(),
		currency: z.string()
	}),
	project_id: z.string().nullable().optional()
});

const costBucketSchema = z.object({
	start_time: z.number(), // unix seconds
	end_time: z.number(),
	results: z.array(costResultSchema)
});

const costPageSchema = z.object({
	data: z.array(costBucketSchema),
	has_more: z.boolean(),
	next_page: z.string().nullable().optional()
});

export type OpenAiCostPage = z.infer<typeof costPageSchema>;

function isoDateFromUnixSeconds(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function normalizeOpenAiCostPage(page: OpenAiCostPage): ProviderCostRow[] {
	const byKey = new Map<string, ProviderCostRow>();

	for (const bucket of page.data) {
		const date = isoDateFromUnixSeconds(bucket.start_time);
		for (const result of bucket.results) {
			const workspaceOrKey = result.project_id ?? 'org';
			const key = `${date}::${workspaceOrKey}`;
			const existing = byKey.get(key);
			if (existing) {
				existing.amountUsd += result.amount.value;
			} else {
				byKey.set(key, {
					provider: 'openai',
					date,
					workspaceOrKey,
					amountUsd: result.amount.value,
					currency: result.amount.currency.toUpperCase(),
					raw: bucket
				});
			}
		}
	}

	return Array.from(byKey.values());
}

async function fetchPage(apiKey: string, window: FetchWindow, page: string | undefined): Promise<OpenAiCostPage> {
	const url = new URL(OPENAI_COSTS_URL);
	url.searchParams.set('start_time', String(Math.floor(Date.parse(window.sinceIso) / 1000)));
	if (window.untilIso) {
		url.searchParams.set('end_time', String(Math.floor(Date.parse(window.untilIso) / 1000)));
	}
	url.searchParams.set('bucket_width', '1d');
	// NOTE: unverified against a real key (provider disabled). The sibling
	// Anthropic adapter's `group_by` needed a `[]` suffix once tested live
	// against the real API (2026-07-03) — re-verify this param's exact shape
	// the same way before flipping this provider on.
	url.searchParams.append('group_by', 'project_id');
	url.searchParams.set('limit', String(PAGE_LIMIT));
	if (page) url.searchParams.set('page', page);

	const response = await fetch(url, {
		headers: { authorization: `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenAI organization/costs ${response.status}: ${body.slice(0, 500)}`);
	}

	return costPageSchema.parse(await response.json());
}

export const openaiProvider: CostProvider = {
	name: 'openai',

	isConnected(env: ProviderSyncEnv): boolean {
		return Boolean(env.OPENAI_ADMIN_API_KEY);
	},

	async fetchWindow(window: FetchWindow, env: ProviderSyncEnv): Promise<ProviderCostRow[]> {
		const apiKey = env.OPENAI_ADMIN_API_KEY;
		if (!apiKey) throw new Error('openaiProvider.fetchWindow called without OPENAI_ADMIN_API_KEY');

		const rows: ProviderCostRow[] = [];
		let page: string | undefined;
		let pageCount = 0;

		do {
			const costPage = await fetchPage(apiKey, window, page);
			rows.push(...normalizeOpenAiCostPage(costPage));
			page = costPage.has_more ? (costPage.next_page ?? undefined) : undefined;
			pageCount += 1;
			if (pageCount >= MAX_PAGES) {
				throw new Error(`OpenAI organization/costs: exceeded ${MAX_PAGES} pages — pagination loop suspected`);
			}
		} while (page);

		return rows;
	}
};
