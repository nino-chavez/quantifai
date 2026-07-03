/**
 * The `Provider` interface (DESIGN.md architectural invariant 3: "all four
 * connectors implement one Provider interface (fetch window -> normalized
 * rows with provenance); no per-provider special-casing outside its
 * adapter"). Every adapter in this directory implements this shape and
 * nothing downstream (the sync orchestrator, the D1 writer) touches a raw
 * provider payload — boundary parsing happens once, inside the adapter
 * (invariant 1), via a Zod schema per adapter.
 *
 * `api_metered` spend is daily-aggregate grain (one row per provider per
 * UTC day per workspace-or-key), never session grain — see
 * migrations/0004_provider_costs.sql.
 */

/** Env shape the orchestrator reads secrets from — a subset of the Worker's `platform.env`, not the whole binding surface, so an adapter only declares the keys it actually needs. */
export interface ProviderSyncEnv {
	ANTHROPIC_ADMIN_API_KEY?: string;
	OPENAI_ADMIN_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
}

export interface FetchWindow {
	/** Inclusive lower bound, RFC 3339. */
	sinceIso: string;
	/** Exclusive upper bound, RFC 3339. Defaults to "now" when omitted. */
	untilIso?: string;
}

/** One normalized daily-aggregate cost row — the adapter boundary's output shape, identical across all providers. */
export interface ProviderCostRow {
	provider: string;
	/** UTC calendar day, YYYY-MM-DD. */
	date: string;
	/** Sentinel 'org' when the provider's API doesn't attribute this row to a specific workspace/key. */
	workspaceOrKey: string;
	amountUsd: number;
	currency: string;
	/** The provider's own bucket payload, stored verbatim for audit/debugging — never read by anything downstream of the adapter. */
	raw: unknown;
}

export interface CostProvider {
	/** Matches migrations/0004_provider_costs.sql `provider_costs.provider` and `provider_sync_state.provider`. */
	readonly name: string;
	/** Absent secret = provider not connected. Checked before every sync attempt — a disconnected provider is never treated as a failed one (DESIGN.md rule 7). */
	isConnected(env: ProviderSyncEnv): boolean;
	/** Fetch + normalize one window of daily-aggregate cost rows. Throws on transport/parse failure — the orchestrator isolates the error per-provider. */
	fetchWindow(window: FetchWindow, env: ProviderSyncEnv): Promise<ProviderCostRow[]>;
}
