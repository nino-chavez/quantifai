-- QuantifAI Next — Initial Schema (Stage 3 prototype slice)
--
-- Salvaged from quantifai-platform's sessions/messages/daily_stats shapes
-- (wip/quantifai-platform/supabase/migrations/20260324000000_initial_schema.sql)
-- WITHOUT org/invite/role tables — ADR-0004: single-user for this slice,
-- user-scoping via auth.uid() lands later if ADR-0003 KQ-3 (external pull) fires.
--
-- Adds (ADR-0004 first slice): units_of_work, session->unit attribution,
-- git_events (time-window commit/session linkage), cost_provenance enum.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Provenance — every cost figure on every table carries one.
-- DESIGN.md rule 1: "Provenance on every dollar" is the credibility spine.
-- ============================================================

CREATE TYPE cost_provenance AS ENUM (
    'subscription_amortized',  -- flat subscription fee apportioned across sessions by usage share (not yet emitted by any importer in this slice)
    'api_metered',             -- observed, billed API usage (BYOK pollers — out of scope this slice, per "Do NOT build")
    'estimated'                -- list-price token valuation applied to subscription-plan usage; NOT what was actually billed
);

-- ============================================================
-- Units of work — initiative / project / session groupings.
-- The ledger's row grain (DESIGN.md L3 unit-of-work-ledger table).
-- ============================================================

CREATE TABLE units_of_work (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text NOT NULL DEFAULT 'project'
                  CHECK (kind IN ('initiative', 'project', 'session')),
    name          text NOT NULL,
    source        text NOT NULL DEFAULT 'path'
                  CHECK (source IN ('git', 'blueprint', 'path')),
    -- normalized repo-name key derived from Claude Code's cwd (preferred) or the
    -- encoded ~/.claude/projects/<dir> name (fallback) — see
    -- src/lib/attribution/project-path.ts normalizeProjectPath(). Sentinel
    -- 'unknown' + NOT NULL: NULL breaks UNIQUE dedup (LESSONS-LEARNED.md).
    project_path  text NOT NULL DEFAULT 'unknown',
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, project_path)
);

CREATE INDEX idx_units_of_work_project_path ON units_of_work(project_path);

-- ============================================================
-- Sessions (aggregated Claude Code conversation sessions).
-- Single-user: no org_id. session_id is globally unique (Claude Code UUIDs).
-- ============================================================

CREATE TABLE sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       text NOT NULL UNIQUE,
    project_path     text NOT NULL DEFAULT 'unknown',
    unit_id          uuid REFERENCES units_of_work(id) ON DELETE SET NULL,
    model            text NOT NULL DEFAULT 'unknown',
    provider         text NOT NULL DEFAULT 'anthropic',
    editor           text,
    input_tokens     bigint NOT NULL DEFAULT 0,
    output_tokens    bigint NOT NULL DEFAULT 0,
    cache_read       bigint NOT NULL DEFAULT 0,
    cache_creation   bigint NOT NULL DEFAULT 0,
    total_cost       numeric(10,6) NOT NULL DEFAULT 0,
    cost_provenance  cost_provenance NOT NULL DEFAULT 'estimated',
    message_count    integer NOT NULL DEFAULT 0,
    started_at       timestamptz,
    ended_at         timestamptz,
    tool_names       text[] DEFAULT '{}',
    source           text NOT NULL DEFAULT 'interactive'
                     CHECK (source IN ('interactive', 'api')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_unit_id ON sessions(unit_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
CREATE INDEX idx_sessions_project_path ON sessions(project_path);

-- ============================================================
-- Messages (individual assistant-turn telemetry records).
-- ============================================================

CREATE TABLE messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       text NOT NULL,
    message_id       text NOT NULL,
    timestamp        timestamptz NOT NULL,
    model            text NOT NULL DEFAULT 'unknown',
    provider         text NOT NULL DEFAULT 'anthropic',
    input_tokens     integer NOT NULL DEFAULT 0,
    output_tokens    integer NOT NULL DEFAULT 0,
    cache_read       integer NOT NULL DEFAULT 0,
    cache_creation   integer NOT NULL DEFAULT 0,
    est_cost         numeric(10,6) NOT NULL DEFAULT 0,
    cost_provenance  cost_provenance NOT NULL DEFAULT 'estimated',
    record_type      text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id)
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- ============================================================
-- Daily aggregates (pre-computed rollups).
-- ============================================================

CREATE TABLE daily_stats (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date            date NOT NULL,
    provider        text NOT NULL DEFAULT 'unknown',
    model           text NOT NULL DEFAULT 'unknown',
    session_count   integer NOT NULL DEFAULT 0,
    message_count   integer NOT NULL DEFAULT 0,
    input_tokens    bigint NOT NULL DEFAULT 0,
    output_tokens   bigint NOT NULL DEFAULT 0,
    total_cost      numeric(10,6) NOT NULL DEFAULT 0,
    UNIQUE (date, provider, model)
);

CREATE INDEX idx_daily_stats_date ON daily_stats(date);

-- ============================================================
-- Git events — the output-pairing signal (ADR-0004: time-window join is the
-- honest v0; git-notes-based linkage per Exceeds Ink is the future mechanism).
-- ============================================================

CREATE TABLE git_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repo          text NOT NULL,
    commit_sha    text NOT NULL,
    authored_at   timestamptz NOT NULL,
    message       text,
    unit_id       uuid REFERENCES units_of_work(id) ON DELETE SET NULL,
    session_id    text,  -- best time-window match; nullable, honest v0
    link_method   text NOT NULL DEFAULT 'time_window'
                  CHECK (link_method IN ('time_window', 'git_notes')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repo, commit_sha)
);

CREATE INDEX idx_git_events_unit_id ON git_events(unit_id);
CREATE INDEX idx_git_events_authored_at ON git_events(authored_at);
