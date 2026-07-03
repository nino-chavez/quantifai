/**
 * OpenRouter cost poller — DISABLED (`isConnected()` gates on
 * `env.OPENROUTER_API_KEY`, which no secret currently backs) and, unlike
 * the Anthropic/OpenAI adapters, only partially "code-complete": as of
 * 2026-07-03, OpenRouter publishes no documented day-bucketed cost-report
 * endpoint (checked https://openrouter.ai/docs/api/reference/overview) —
 * only a cumulative-balance endpoint (`GET /api/v1/credits`, `total_usage`
 * since account creation) and a per-generation stats endpoint. This adapter
 * ports the sibling scan's `quantifai-lite` OpenRouter poller *shape*
 * (single-provider snapshot, sibling-project-scan.md) against the real
 * endpoint that exists, with an explicit limitation documented below rather
 * than fabricating a day-bucket API OpenRouter doesn't have.
 *
 * Known limitation (flagged, not silently shipped): `total_usage` is
 * cumulative-since-account-creation, not a daily delta. This adapter writes
 * ONE row keyed to the sync run's UTC calendar day carrying the *current*
 * cumulative total; computing a true daily delta requires diffing against
 * the prior sync's stored total (the `provider_costs` UNIQUE upsert already
 * makes each day's row idempotent/replaceable — the delta computation
 * itself is deferred until this provider is actually connected, since
 * writing delta logic against an unverified, disabled endpoint risks
 * shipping an untested bug). Re-verify this shape against a real
 * `OPENROUTER_API_KEY` before flipping this provider on.
 */

import { z } from 'zod';
import type { CostProvider, FetchWindow, ProviderCostRow, ProviderSyncEnv } from './types';

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

const creditsResponseSchema = z.object({
	data: z.object({
		total_credits: z.number(),
		total_usage: z.number()
	})
});

export type OpenRouterCreditsResponse = z.infer<typeof creditsResponseSchema>;

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

export function normalizeOpenRouterCredits(response: OpenRouterCreditsResponse, asOfDate: string): ProviderCostRow[] {
	return [
		{
			provider: 'openrouter',
			date: asOfDate,
			workspaceOrKey: 'org',
			amountUsd: response.data.total_usage,
			currency: 'USD',
			raw: response
		}
	];
}

export const openrouterProvider: CostProvider = {
	name: 'openrouter',

	isConnected(env: ProviderSyncEnv): boolean {
		return Boolean(env.OPENROUTER_API_KEY);
	},

	async fetchWindow(_window: FetchWindow, env: ProviderSyncEnv): Promise<ProviderCostRow[]> {
		const apiKey = env.OPENROUTER_API_KEY;
		if (!apiKey) throw new Error('openrouterProvider.fetchWindow called without OPENROUTER_API_KEY');

		const response = await fetch(OPENROUTER_CREDITS_URL, {
			headers: { authorization: `Bearer ${apiKey}` }
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(`OpenRouter credits ${response.status}: ${body.slice(0, 500)}`);
		}

		const parsed = creditsResponseSchema.parse(await response.json());
		return normalizeOpenRouterCredits(parsed, todayUtc());
	}
};
