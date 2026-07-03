/**
 * Anthropic model pricing table — list price per 1M tokens.
 *
 * Pattern salvaged from quantifai-lite's `estimateAnthropicCost()`
 * (src/lib/providers/anthropic.ts), restructured as a data table instead of
 * an if/else chain so a new tier is one row, not a branch.
 *
 * IMPORTANT — what this number means (DESIGN.md rule 1, provenance spine):
 * this is a *list-price token valuation*, not a metered bill. Claude Code
 * sessions run under a Max/Pro subscription (flat monthly fee); the operator
 * was not charged per-token for them. This table answers "what would these
 * tokens have cost on pay-as-you-go API pricing" — useful as a comparison
 * anchor and a routing-calibration signal, but it must never be presented as
 * an observed charge. The importer that calls this (see
 * `scripts/import-claude-jsonl.ts`) marks every session's cost_provenance as
 * `'estimated'` for exactly this reason, never `'api_metered'`.
 */

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
}

export interface PricingRow {
	/** Matched against the lowercased model string via substring test. */
	match: string;
	inputPer1M: number;
	outputPer1M: number;
	cacheReadPer1M: number;
	cacheCreationPer1M: number;
}

// Order matters: first match wins. Opus/haiku are checked before the sonnet
// fallback so "claude-3-5-sonnet" and "claude-opus-4" both resolve correctly.
export const ANTHROPIC_PRICING_TABLE: PricingRow[] = [
	{
		match: 'opus',
		inputPer1M: 15.0,
		outputPer1M: 75.0,
		cacheReadPer1M: 1.5,
		cacheCreationPer1M: 18.75
	},
	{
		match: 'haiku',
		inputPer1M: 0.8,
		outputPer1M: 4.0,
		cacheReadPer1M: 0.08,
		cacheCreationPer1M: 1.0
	},
	{
		match: 'sonnet',
		inputPer1M: 3.0,
		outputPer1M: 15.0,
		cacheReadPer1M: 0.3,
		cacheCreationPer1M: 3.75
	}
];

// Applied when no row matches (unknown/future model string). Sonnet-tier
// rates are the documented fallback — matches the table's own default tier
// and is the safest mid-point guess, not silently zero.
const FALLBACK_ROW: PricingRow = ANTHROPIC_PRICING_TABLE.find((r) => r.match === 'sonnet')!;

export interface CostEstimate {
	costUsd: number;
	/** false when the model string matched no known tier and the fallback rate was used. */
	matched: boolean;
	matchedTier: string;
}

export function estimateAnthropicCost(model: string, usage: TokenUsage): CostEstimate {
	const m = (model ?? '').toLowerCase();
	const row = ANTHROPIC_PRICING_TABLE.find((r) => m.includes(r.match));
	const active = row ?? FALLBACK_ROW;

	const costUsd =
		(usage.inputTokens / 1_000_000) * active.inputPer1M +
		(usage.outputTokens / 1_000_000) * active.outputPer1M +
		(usage.cacheReadTokens / 1_000_000) * active.cacheReadPer1M +
		(usage.cacheCreationTokens / 1_000_000) * active.cacheCreationPer1M;

	return {
		costUsd,
		matched: row !== undefined,
		matchedTier: active.match
	};
}
