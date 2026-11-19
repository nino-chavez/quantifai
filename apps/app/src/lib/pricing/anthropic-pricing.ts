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
	/** Every cache-write token, 5-minute and 1-hour together. */
	cacheCreationTokens: number;
	/** The 1-hour share of `cacheCreationTokens`, when the usage block reports it; the rest is priced as 5-minute writes. */
	cacheCreation1hTokens?: number;
}

export interface PricingRates {
	inputPer1M: number;
	outputPer1M: number;
	cacheReadPer1M: number;
	/** 5-minute cache-write rate: 1.25x the input price. */
	cacheCreationPer1M: number;
	/** 1-hour cache-write rate: 2x the input price (pricing page, prompt caching multipliers). */
	cacheCreation1hPer1M: number;
}

export interface PricingRow extends PricingRates {
	/** Matched against the lowercased model string via substring test. */
	match: string;
	/**
	 * Prompt-length pricing. A request whose prompt (input + cache read +
	 * cache creation) exceeds `overPromptTokens` pays `rates` for every token
	 * category. Only Claude Haiku 5.5 is priced this way today.
	 */
	longPrompt?: { overPromptTokens: number; rates: PricingRates };
}

function rates(input: number, output: number, cacheRead: number, cacheCreation: number): PricingRates {
	return { inputPer1M: input, outputPer1M: output, cacheReadPer1M: cacheRead, cacheCreationPer1M: cacheCreation, cacheCreation1hPer1M: input * 2 };
}

function row(match: string, input: number, output: number, cacheRead: number, cacheCreation: number): PricingRow {
	return { match, ...rates(input, output, cacheRead, cacheCreation) };
}

// List prices from platform.claude.com/docs/en/about-claude/pricing, read
// 2026-10-07; Fable 5.2, Mythos 5.2 and the Sonnet 5.5 cache read re-read
// 2026-11-19. Columns: input, output, cache read, 5m cache write. The 1-hour
// cache-write rate is derived: twice the input price.
//
// Order matters: first match wins, so a version must come before any key it
// contains ("opus-5-5" before "opus-5", "opus-4-5" before "opus-4"). The
// three bare family rows at the end catch older or unrecognised versions
// (claude-3-opus, claude-3-5-haiku, claude-3-5-sonnet) at the legacy rates
// this table carried before versioned rows existed.
export const ANTHROPIC_PRICING_TABLE: PricingRow[] = [
	row('fable-5-2', 8, 40, 0.2, 10),
	row('mythos-5-2', 8, 40, 0.2, 10),
	row('fable-5-1', 10, 50, 0.25, 12.5),
	row('mythos-5-1', 10, 50, 0.25, 12.5),
	row('fable-5', 10, 50, 1, 12.5),
	row('mythos-5', 10, 50, 1, 12.5),
	row('opus-5-5', 4, 20, 0.2, 5),
	row('opus-5', 5, 25, 0.5, 6.25),
	row('opus-4-8', 5, 25, 0.5, 6.25),
	row('opus-4-7', 5, 25, 0.5, 6.25),
	row('opus-4-6', 5, 25, 0.5, 6.25),
	row('opus-4-5', 5, 25, 0.5, 6.25),
	row('opus-4', 15, 75, 1.5, 18.75),
	// The pricing page's model table and caching section both list $0.10 for a
	// Sonnet 5.5 cache read (read 2026-11-19); on 2026-10-07 they disagreed.
	row('sonnet-5-5', 2, 10, 0.1, 2.5),
	row('sonnet-5', 2, 10, 0.2, 2.5),
	{
		...row('haiku-5-5', 0.1, 0.5, 0.01, 0.125),
		longPrompt: {
			overPromptTokens: 100_000,
			rates: rates(0.5, 2.5, 0.05, 0.625)
		}
	},
	row('haiku-4-5', 1, 5, 0.1, 1.25),
	row('opus', 15, 75, 1.5, 18.75),
	row('haiku', 0.8, 4, 0.08, 1),
	row('sonnet', 3, 15, 0.3, 3.75)
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
	const tier = row ?? FALLBACK_ROW;
	const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
	const active =
		tier.longPrompt && promptTokens > tier.longPrompt.overPromptTokens ? tier.longPrompt.rates : tier;

	// The 1-hour share can never exceed the cache write it is part of.
	const oneHour = Math.min(usage.cacheCreation1hTokens ?? 0, usage.cacheCreationTokens);
	const fiveMinute = usage.cacheCreationTokens - oneHour;

	const costUsd =
		(usage.inputTokens / 1_000_000) * active.inputPer1M +
		(usage.outputTokens / 1_000_000) * active.outputPer1M +
		(usage.cacheReadTokens / 1_000_000) * active.cacheReadPer1M +
		(fiveMinute / 1_000_000) * active.cacheCreationPer1M +
		(oneHour / 1_000_000) * active.cacheCreation1hPer1M;

	return {
		costUsd,
		matched: row !== undefined,
		matchedTier: tier.match
	};
}
