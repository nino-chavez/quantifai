-- OpenRouter adapter upgrade (credits-snapshot -> daily activity,
-- src/lib/providers/openrouter.ts). The old adapter wrote ONE row per sync
-- keyed to that sync's UTC calendar day, carrying the *lifetime* cumulative
-- total from `GET /api/v1/credits` as if it were that single day's spend
-- (`openrouter, <sync day>, 'org'`). The new adapter instead writes true
-- daily rows from `GET /api/v1/activity` plus a `2025-01-01 /
-- 'org-historical'` remainder row for pre-activity-window spend (see the
-- adapter's module header). The old snapshot row would double-count
-- against the new rows if left in place — delete it before the new sync
-- lands.
--
-- Idempotent/deterministic: matches on the exact (provider, workspace_or_key,
-- provenance) shape the old adapter always wrote, not a specific date, so
-- re-running this migration after the cutover (or against a DB that never
-- had the old row) is a no-op either way.
DELETE FROM provider_costs
WHERE provider = 'openrouter'
  AND workspace_or_key = 'org'
  AND provenance = 'api_metered';
