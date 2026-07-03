-- Provider-metered cost pollers (slice 3). Two tables:
--
-- `provider_costs` — daily-aggregate API-metered spend pulled from each
-- provider's admin/cost API (Anthropic Cost API and OpenRouter's daily
-- activity endpoint are connected; OpenAI ships code-complete but
-- disabled — see src/lib/providers/). This is
-- REAL spend (DESIGN.md rule 1 extension, documented in
-- src/lib/pricing/ actual-spend module): unlike `sessions`, which is
-- session-grain and mixes `estimated`/`subscription_amortized`/
-- `api_metered` provenance, this table is DAY-grain per (provider,
-- workspace-or-key) and carries only `api_metered` provenance — never
-- fabricate synthetic session rows for it (per the sibling-scan poller
-- shapes: quantifai-lite's pollers wrote day-bucket rows, not sessions).
--
-- `workspace_or_key` uses the sentinel 'org' when the provider's API
-- doesn't attribute a bucket to a specific workspace/key (e.g. an
-- Anthropic org with no workspaces configured, or a provider whose cost
-- API has no sub-org grouping) — NOT NULL + sentinel, same NULL-breaks-
-- UNIQUE-dedup rule the rest of this schema follows (LESSONS-LEARNED.md).
--
-- `provider_sync_state` — one row per provider tracking the last sync
-- attempt, independent of whether the provider is "connected" (secret
-- present). `not_connected` is a distinct, honest status (DESIGN.md rule
-- 7: unconnected providers render as "not connected," never as an
-- error or an empty chart) — it is written by the sync orchestrator for
-- any provider whose secret is absent, so the connections state has a
-- queryable row instead of silence.

CREATE TABLE provider_costs (
    id                TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    date              TEXT NOT NULL, -- UTC calendar day, YYYY-MM-DD
    -- Sentinel 'org' + NOT NULL: NULL breaks UNIQUE dedup (LESSONS-LEARNED.md).
    workspace_or_key  TEXT NOT NULL DEFAULT 'org',
    amount_usd        REAL NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'USD',
    provenance        TEXT NOT NULL DEFAULT 'api_metered'
                      CHECK (provenance IN ('api_metered')),
    raw_metadata      TEXT NOT NULL DEFAULT '{}', -- JSON, the provider's own bucket payload
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (provider, date, workspace_or_key)
);

CREATE INDEX idx_provider_costs_date ON provider_costs(date);
CREATE INDEX idx_provider_costs_provider ON provider_costs(provider);

CREATE TABLE provider_sync_state (
    provider          TEXT PRIMARY KEY,
    last_sync_at      TEXT, -- ISO timestamp of the last *successful* sync; NULL if never succeeded
    last_sync_status  TEXT NOT NULL DEFAULT 'never_run'
                      CHECK (last_sync_status IN ('ok', 'error', 'not_connected', 'never_run')),
    last_sync_error   TEXT, -- user-visible (DESIGN.md connections-panel organism spec)
    rows_written      INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
