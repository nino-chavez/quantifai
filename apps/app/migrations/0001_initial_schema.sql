-- QuantifAI Next — D1 (SQLite) schema. Ported from the Postgres/Supabase
-- schema at apps/app/supabase/migrations/20260703000000_initial_schema.sql
-- per ADR-0005 (pure Cloudflare: Workers + D1 + Access, superseding the
-- Supabase/Vercel line).
--
-- Dialect translation notes (SQLite has no PL/pgSQL, no native enum/array
-- types, no gen_random_uuid()):
--   - uuid PRIMARY KEY -> TEXT PRIMARY KEY, ids generated in the Worker via
--     crypto.randomUUID() before INSERT (no server-side UUID function).
--   - PG enum `cost_provenance` -> TEXT + CHECK constraint (same values).
--   - timestamptz -> TEXT, ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`), written by
--     application code — never SQLite's own `CURRENT_TIMESTAMP` (which
--     omits the 'T'/'Z' and loses timezone-explicitness).
--   - numeric(10,6) -> REAL. bigint/integer -> INTEGER.
--   - text[] (tool_names, file_paths) -> TEXT, JSON-encoded array. Merged/
--     read via SQLite's JSON1 functions (json_each, json_group_array) or
--     app-side JSON.parse/stringify — see src/lib/server/sessions.ts.
--   - The two Postgres functions (upsert_session, get_unit_of_work_ledger)
--     become plain parameterized SQL in src/lib/server/ — a Worker queries
--     D1 directly with no PostgREST row cap, so no RPC indirection is
--     needed (ADR-0005).
--
-- Stage 3 semantics preserved exactly (per ADR-0004 deviation note in the
-- original migration): sentinel 'unknown' NOT NULL on project_path (never
-- NULL — NULL breaks UNIQUE dedup); provenance enum values unchanged
-- (subscription_amortized | api_metered | estimated).

-- ============================================================
-- Units of work — initiative / project / session groupings.
-- ============================================================

CREATE TABLE units_of_work (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'project'
                  CHECK (kind IN ('initiative', 'project', 'session')),
    name          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'path'
                  CHECK (source IN ('git', 'blueprint', 'path')),
    -- Sentinel 'unknown' + NOT NULL: NULL breaks UNIQUE dedup.
    project_path  TEXT NOT NULL DEFAULT 'unknown',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (kind, project_path)
);

CREATE INDEX idx_units_of_work_project_path ON units_of_work(project_path);

-- ============================================================
-- Sessions (aggregated Claude Code conversation sessions).
-- Single-user: no org_id. session_id is globally unique (Claude Code UUIDs).
-- ============================================================

CREATE TABLE sessions (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL UNIQUE,
    project_path     TEXT NOT NULL DEFAULT 'unknown',
    unit_id          TEXT REFERENCES units_of_work(id) ON DELETE SET NULL,
    model            TEXT NOT NULL DEFAULT 'unknown',
    provider         TEXT NOT NULL DEFAULT 'anthropic',
    editor           TEXT,
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    cache_read       INTEGER NOT NULL DEFAULT 0,
    cache_creation   INTEGER NOT NULL DEFAULT 0,
    total_cost       REAL NOT NULL DEFAULT 0,
    cost_provenance  TEXT NOT NULL DEFAULT 'estimated'
                     CHECK (cost_provenance IN ('subscription_amortized', 'api_metered', 'estimated')),
    message_count    INTEGER NOT NULL DEFAULT 0,
    started_at       TEXT,
    ended_at         TEXT,
    tool_names       TEXT NOT NULL DEFAULT '[]', -- JSON array
    source           TEXT NOT NULL DEFAULT 'interactive'
                     CHECK (source IN ('interactive', 'api')),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sessions_unit_id ON sessions(unit_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
CREATE INDEX idx_sessions_project_path ON sessions(project_path);

-- ============================================================
-- Messages (individual assistant-turn telemetry records).
-- ============================================================

CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    message_id       TEXT NOT NULL,
    timestamp        TEXT NOT NULL,
    model            TEXT NOT NULL DEFAULT 'unknown',
    provider         TEXT NOT NULL DEFAULT 'anthropic',
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    cache_read       INTEGER NOT NULL DEFAULT 0,
    cache_creation   INTEGER NOT NULL DEFAULT 0,
    est_cost         REAL NOT NULL DEFAULT 0,
    cost_provenance  TEXT NOT NULL DEFAULT 'estimated'
                     CHECK (cost_provenance IN ('subscription_amortized', 'api_metered', 'estimated')),
    record_type      TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (message_id)
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- ============================================================
-- Daily aggregates (pre-computed rollups). Ported for schema parity;
-- unused by any query in this slice (same as the Postgres original).
-- ============================================================

CREATE TABLE daily_stats (
    id              TEXT PRIMARY KEY,
    date            TEXT NOT NULL,
    provider        TEXT NOT NULL DEFAULT 'unknown',
    model           TEXT NOT NULL DEFAULT 'unknown',
    session_count   INTEGER NOT NULL DEFAULT 0,
    message_count   INTEGER NOT NULL DEFAULT 0,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    UNIQUE (date, provider, model)
);

CREATE INDEX idx_daily_stats_date ON daily_stats(date);

-- ============================================================
-- Git events — the output-pairing signal (ADR-0004: time-window join is the
-- honest v0; git-notes-based linkage per Exceeds Ink is the future mechanism).
-- ============================================================

CREATE TABLE git_events (
    id            TEXT PRIMARY KEY,
    repo          TEXT NOT NULL,
    commit_sha    TEXT NOT NULL,
    authored_at   TEXT NOT NULL,
    message       TEXT,
    unit_id       TEXT REFERENCES units_of_work(id) ON DELETE SET NULL,
    session_id    TEXT,  -- best time-window match; nullable, honest v0
    link_method   TEXT NOT NULL DEFAULT 'time_window'
                  CHECK (link_method IN ('time_window', 'git_notes')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (repo, commit_sha)
);

CREATE INDEX idx_git_events_unit_id ON git_events(unit_id);
CREATE INDEX idx_git_events_authored_at ON git_events(authored_at);
