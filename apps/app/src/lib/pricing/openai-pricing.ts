/**
 * OpenAI pay-as-you-go valuation for Codex usage (`cost_provenance =
 * 'estimated'`) — the OpenAI counterpart of anthropic-pricing.ts.
 *
 * Source: https://developers.openai.com/api/docs/pricing, Standard tier,
 * short-context columns, read 2026-10-06. The flagship rows (gpt-6-astra,
 * gpt-6.1-sol, gpt-6-luna) are in the rendered table; the rest are only in
 * the page's embedded "All models" data. Codex reports a 258,400-token
 * context window, under the long-context tier, so short-context rates apply.
 *
 * Two deliberate differences from the Anthropic table:
 *   - Exact model match, not substring. OpenAI names nest (`gpt-6-sol` vs
 *     `gpt-6.1-sol`), and the tiers are priced differently.
 *   - No fallback row. An unlisted model (e.g. `codex-auto-review`, which the
 *     pricing page does not list) returns `matched: false` and $0, and the
 *     caller reports it as unpriced. Guessing a rate for an internal model
 *     would put an invented number in the ledger. `gpt-5.3-codex-spark` is
 *     also unlisted.
 *
 * Token convention: OpenAI reports `input_tokens` INCLUDING cached input and
 * `output_tokens` INCLUDING reasoning. Callers pass the Anthropic-shaped
 * split (uncached input, cache reads, output) — see codex-rollout.ts.
 */

import type { TokenUsage, CostEstimate } from './anthropic-pricing';

export interface OpenAIPricingRow {
	model: string;
	inputPer1M: number;
	cachedInputPer1M: number;
	cacheWritePer1M: number;
	outputPer1M: number;
}

export const OPENAI_PRICING_TABLE: OpenAIPricingRow[] = [
	{ model: 'gpt-6-astra', inputPer1M: 10.0, cachedInputPer1M: 1.0, cacheWritePer1M: 12.5, outputPer1M: 50.0 },
	{ model: 'gpt-6.1-sol', inputPer1M: 2.0, cachedInputPer1M: 0.1, cacheWritePer1M: 2.5, outputPer1M: 10.0 },
	{ model: 'gpt-6-sol', inputPer1M: 2.0, cachedInputPer1M: 0.2, cacheWritePer1M: 2.5, outputPer1M: 10.0 },
	{ model: 'gpt-6-luna', inputPer1M: 0.1, cachedInputPer1M: 0.01, cacheWritePer1M: 0.125, outputPer1M: 0.5 },
	{ model: 'gpt-5.6-sol', inputPer1M: 4.0, cachedInputPer1M: 0.4, cacheWritePer1M: 5.0, outputPer1M: 20.0 },
	{ model: 'gpt-5.6-terra', inputPer1M: 2.0, cachedInputPer1M: 0.2, cacheWritePer1M: 2.5, outputPer1M: 12.0 },
	{ model: 'gpt-5.6-luna', inputPer1M: 0.2, cachedInputPer1M: 0.02, cacheWritePer1M: 0.25, outputPer1M: 1.2 },
	{ model: 'gpt-5.5', inputPer1M: 5.0, cachedInputPer1M: 0.5, cacheWritePer1M: 0, outputPer1M: 30.0 },
	{ model: 'gpt-5.3-codex', inputPer1M: 1.75, cachedInputPer1M: 0.175, cacheWritePer1M: 0, outputPer1M: 14.0 }
];

export function estimateOpenAICost(model: string, usage: TokenUsage): CostEstimate {
	const m = (model ?? '').toLowerCase();
	const row = OPENAI_PRICING_TABLE.find((r) => r.model === m);
	if (!row) return { costUsd: 0, matched: false, matchedTier: 'unpriced' };

	const costUsd =
		(usage.inputTokens / 1_000_000) * row.inputPer1M +
		(usage.cacheReadTokens / 1_000_000) * row.cachedInputPer1M +
		(usage.cacheCreationTokens / 1_000_000) * row.cacheWritePer1M +
		(usage.outputTokens / 1_000_000) * row.outputPer1M;

	return { costUsd, matched: true, matchedTier: row.model };
}
