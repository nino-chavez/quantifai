-- QuantifAI Next — Postgres RPC functions
--
-- Adapted from quantifai-platform's upsert_session() / get_dashboard_totals()
-- (.../20260324000001_functions.sql, "proven in quantifai-lite").
-- LESSONS-LEARNED.md constraints applied throughout: atomic SQL upsert
-- (never JS read-modify-write — lost-update race under concurrent ingest),
-- RPC for >1000-row aggregates (Supabase/PostgREST default row cap).

-- ============================================================
-- Atomic unit-of-work upsert. Idempotent on (kind, project_path).
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_unit_of_work(
    p_kind         text,
    p_name         text,
    p_source       text,
    p_project_path text
) RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO units_of_work (kind, name, source, project_path)
    VALUES (p_kind, p_name, p_source, p_project_path)
    ON CONFLICT (kind, project_path) DO UPDATE SET
        name = EXCLUDED.name,
        source = EXCLUDED.source
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Atomic session upsert (proven in quantifai-lite / quantifai-platform).
-- No org_id (single-user, ADR-0004). Accumulates counters under
-- ON CONFLICT DO UPDATE SET col = col + EXCLUDED.col — the only correct
-- approach under concurrent ingest (LESSONS-LEARNED.md).
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_session(
    p_session_id      text,
    p_project_path    text DEFAULT 'unknown',
    p_unit_id         uuid DEFAULT NULL,
    p_model           text DEFAULT 'unknown',
    p_provider        text DEFAULT 'anthropic',
    p_editor          text DEFAULT NULL,
    p_input_tokens    bigint DEFAULT 0,
    p_output_tokens   bigint DEFAULT 0,
    p_cache_read      bigint DEFAULT 0,
    p_cache_creation  bigint DEFAULT 0,
    p_total_cost      numeric DEFAULT 0,
    p_cost_provenance cost_provenance DEFAULT 'estimated',
    p_message_count   integer DEFAULT 0,
    p_started_at      timestamptz DEFAULT NULL,
    p_ended_at        timestamptz DEFAULT NULL,
    p_tool_names      text[] DEFAULT '{}',
    p_source          text DEFAULT 'interactive'
) RETURNS void AS $$
BEGIN
    INSERT INTO sessions (
        session_id, project_path, unit_id, model, provider, editor,
        input_tokens, output_tokens, cache_read, cache_creation,
        total_cost, cost_provenance, message_count, started_at, ended_at,
        tool_names, source
    ) VALUES (
        p_session_id, p_project_path, p_unit_id, p_model, p_provider, p_editor,
        p_input_tokens, p_output_tokens, p_cache_read, p_cache_creation,
        p_total_cost, p_cost_provenance, p_message_count, p_started_at, p_ended_at,
        p_tool_names, p_source
    )
    ON CONFLICT (session_id) DO UPDATE SET
        project_path = COALESCE(EXCLUDED.project_path, sessions.project_path),
        unit_id = COALESCE(EXCLUDED.unit_id, sessions.unit_id),
        model = COALESCE(EXCLUDED.model, sessions.model),
        provider = COALESCE(EXCLUDED.provider, sessions.provider),
        editor = COALESCE(EXCLUDED.editor, sessions.editor),
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cache_read = EXCLUDED.cache_read,
        cache_creation = EXCLUDED.cache_creation,
        total_cost = EXCLUDED.total_cost,
        cost_provenance = EXCLUDED.cost_provenance,
        message_count = EXCLUDED.message_count,
        started_at = LEAST(sessions.started_at, EXCLUDED.started_at),
        ended_at = GREATEST(sessions.ended_at, EXCLUDED.ended_at),
        tool_names = (
            SELECT ARRAY(SELECT DISTINCT unnest(sessions.tool_names || EXCLUDED.tool_names))
        );
END;
$$ LANGUAGE plpgsql;
-- Note: unlike the platform's version (which accumulates col = col + EXCLUDED.col
-- for a stream of partial deltas), this importer recomputes each session's full
-- totals from its source JSONL on every run and upserts the total, not a delta —
-- the source file is idempotent ground truth, not a stream of increments. Re-running
-- the importer against the same file is therefore also idempotent.

-- ============================================================
-- Ledger totals — avoids Supabase/PostgREST's default 1000-row cap on the
-- one query the UI cannot afford to silently truncate: the practice hero total.
-- ============================================================

CREATE OR REPLACE FUNCTION get_ledger_totals()
RETURNS TABLE (
    total_sessions       bigint,
    total_cost           numeric,
    metered_cost         numeric,
    estimated_cost       numeric,
    subscription_cost    numeric,
    total_commits        bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::bigint,
        COALESCE(SUM(s.total_cost), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'api_metered'), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'estimated'), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'subscription_amortized'), 0)::numeric,
        (SELECT COUNT(*) FROM git_events)::bigint
    FROM sessions s;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- Per-unit-of-work rollup — the ledger table's row source.
-- ============================================================

CREATE OR REPLACE FUNCTION get_unit_of_work_ledger()
RETURNS TABLE (
    unit_id           uuid,
    kind              text,
    name              text,
    project_path      text,
    session_count     bigint,
    total_cost        numeric,
    metered_cost      numeric,
    estimated_cost    numeric,
    subscription_cost numeric,
    commit_count      bigint,
    first_session_at  timestamptz,
    last_session_at   timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.kind,
        u.name,
        u.project_path,
        COUNT(s.id)::bigint,
        COALESCE(SUM(s.total_cost), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'api_metered'), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'estimated'), 0)::numeric,
        COALESCE(SUM(s.total_cost) FILTER (WHERE s.cost_provenance = 'subscription_amortized'), 0)::numeric,
        (SELECT COUNT(*) FROM git_events g WHERE g.unit_id = u.id)::bigint,
        MIN(s.started_at),
        MAX(s.ended_at)
    FROM units_of_work u
    LEFT JOIN sessions s ON s.unit_id = u.id
    GROUP BY u.id, u.kind, u.name, u.project_path
    -- Ordinal ref, not the column alias: "total_cost" is ambiguous inside
    -- plpgsql (it collides with the RETURNS TABLE OUT-parameter of the same
    -- name), and Postgres will not let ORDER BY disambiguate it any other way.
    ORDER BY 6 DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql STABLE;
