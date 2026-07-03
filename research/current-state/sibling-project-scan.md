# Sibling-Project Scan — quantifai-next

Date: 2026-07-03 · Gate artifact for `research-sibling-scanner`. Every cited decision doc was read, not assumed; two of the brief's assumptions were corrected by the scan (rally-hq, supabase-watch below).

Primitives scanned for: (a) usage/telemetry ingestion, (b) provider-API polling + credential storage, (c) metrics dashboards with aggregation, (d) org/invite-scoped auth, (e) cron aggregation, (f) encrypted third-party credentials.

## quantifai-platform (`wip/quantifai-platform`) — direct ancestor · COPY

Ships (a)(c)(d)(e)(f). Explicitly absent: (b) — provider polling was never built here.

- Schema: `organizations`, `user_roles`, `org_invites`, `api_keys` (SHA-256), `provider_connections` (AES-256-GCM), `daily_stats` with `UNIQUE(org_id,date,provider,model)`, RLS on all 8 tables (`supabase/migrations/20260324000000_initial_schema.sql`).
- `upsert_session()` atomic `ON CONFLICT DO UPDATE SET col = col + EXCLUDED.col` — in-code comment: "proven in quantifai-lite" — and `get_dashboard_totals()` RPC dodging Supabase's 1000-row select cap (`.../20260324000001_functions.sql`).
- Ingest route: Bearer ingest-role auth, 10k batch cap, 500-row dedup chunks with `ignoreDuplicates` (`src/routes/api/v1/ingest/+server.ts`). Cron rollup to `daily_stats` (`src/routes/api/v1/cron/aggregate/+server.ts`).
- **Decision doc read — `docs/deployment/appsec-review-v2.md`** (de facto ADR, 2026-03-24): decision was to replace v1's FastAPI+PgBouncer+Redis+WebSocket 252-endpoint monolith with SvelteKit-only, external-cron-over-HTTP, Web Crypto AES-256-GCM. Open risks to carry as a checklist: R5 static `CRON_SECRET` (recommends host-native OIDC cron auth), R6 invite auto-claim lacks domain allowlist, R1/R2 manual key rotation with no KMS.
- **Decision doc read — `docs/deployment/provider-data-brief.md`**: per-provider PII/security brief (Anthropic Admin API, OpenAI, Copilot, "Cursor: no public API" as of 2026-03, Gemini via BigQuery billing export). Notes no provider usage API exposed per-user token breakdowns at that time except the shipper path — **stale by July 2026 (Claude Code Analytics API now exists); the provider-feasibility sweep supersedes this doc's capability claims, but its PII framing stays reusable.**

Recommendation: copy `initial_schema.sql` + `functions.sql` near-verbatim (add polling metadata columns), copy the ingest/cron/auth route structure, carry the appsec risk list as a checklist.

## quantifai-lite (scratchpad clone) — only working provider pollers in the workspace · COPY POLLERS

Ships (b)(e)(f), single-tenant (no org scoping).

- Pollers: `src/lib/providers/anthropic.ts` (Admin API `usage_report/messages`, day-paginated, own per-model cost table since the endpoint returns no cost), `openai.ts`, `openrouter.ts`, dispatched by `cron/sync-providers/+server.ts` — smart date range from `last_synced_at` with 1-day overlap, per-connection error isolation (`last_sync_error` written back; one bad connection doesn't fail the run).
- Crypto: `src/lib/crypto.ts` AES-256-GCM — superseded by platform's cleaner version of the same design.
- **Decision doc read — `LESSONS-LEARNED.md`** (27-bug audit, 2026-03-19/20), hard-won constraints that function as ADRs: session upsert must be atomic SQL, not JS read-modify-write (lost-update race); chunk `.in()` at 500 (PostgREST 414s); aggregates past 1000 rows go through RPC, never `SELECT *`; NULL columns in UNIQUE constraints don't dedupe — use sentinels + NOT NULL; cron auth must be `!CRON_SECRET || mismatch`, never `CRON_SECRET && mismatch` (unset env var silently opens the endpoint — the fix is visible propagated into platform's `cron/aggregate/+server.ts:19`).

Recommendation: copy pollers verbatim; treat LESSONS-LEARNED.md as a pre-flight checklist for all new ingestion code.

## rally-hq (`apps/rally-hq`) — narrower than assumed · ADAPT NARROWLY

Ships the `@supabase/ssr` client + auth-hooks pattern only. **Correction to the brief:** zero `org_id`/`organization_id` hits in `src` — no multi-tenant scoping; its crons are notification sends (recap emails, digests), not metrics rollups.

- `src/lib/supabase.ts`: browser-client singleton + `getFreshAccessToken()` with documented 60s pre-expiry refresh skew (long organizer sessions outlive the 1-hour JWT; background tabs throttle the refresh timer). `src/hooks.server.ts` (468 lines) is the workspace's fullest auth-hooks implementation.
- **Decision doc read — `docs/decisions/0010-notification-dispatch.md`** (proposed, 2026-06-04): one `notify(event, context)` seam owning recipient resolution, preference gating, channel fan-out, and idempotency; rejects per-feature send helpers and third-party orchestration. Cited accurately as a notification-seam ADR — relevant to quantifai-next only if/when budget-threshold alerts ship.
- Lineage confirmed: quantifai-platform commit `6857445` ("align auth with rally-hq pattern using @supabase/ssr") exists.

Recommendation: copy the SSR client shape and refresh-skew pattern; do not source org scoping or aggregation from here — the workspace precedent for those is quantifai-platform itself.

## supabase-watch (`tools/supabase-watch`) — NOT a sibling · IGNORE

Cloudflare cron Worker scraping Supabase infra metrics (disk/memory/reachability) with alarm-transition emails. No usage/cost telemetry, no dashboards, no target primitive. Its own README excludes quantifai: "Archived/wip Supabase projects (630, atelier, quantifai, etc.) are intentionally excluded."

## Ruled out by sweep

`grep -rE` across `apps/`, `tools/`, `wip/` (depth ≤2, node_modules excluded) for credential-encryption, usage-dashboard, and rollup-cron patterns: no other repo has a `provider_connections`-shaped table, AES-GCM credential storage, or a `daily_stats` rollup. letspepper/photography share only Turnstile/cron-adjacent infra — different primitive, not listed.

## Net inheritance map

| Primitive | Source |
|---|---|
| Schema, ingest, org/invite auth, cron rollup | quantifai-platform |
| Provider pollers (Anthropic/OpenAI/OpenRouter) | quantifai-lite |
| Supabase SSR client + refresh skew | rally-hq (narrowly) |
| Provider PII framing | platform `provider-data-brief.md` (capability claims superseded by the July-2026 feasibility sweep) |
| Pre-flight bug checklist | lite `LESSONS-LEARNED.md` |
