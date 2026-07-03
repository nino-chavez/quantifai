-- Grants — salvaged from quantifai-platform's fix_grants.sql
-- (.../20260324000004_fix_grants.sql), same root cause: a fresh schema
-- doesn't inherit Supabase's default anon/authenticated/service_role grants.
--
-- No RLS in this slice: ADR-0004 is single-user with no auth yet (auth lands
-- only if ADR-0003 KQ-3 fires). The admin client (service_role) is the only
-- reader/writer today — see src/lib/server/db.ts. anon/authenticated grants
-- are pre-provisioned narrowly (SELECT only) so that a future auth pass adds
-- RLS policies, not a fresh grants migration.

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated, anon;
