# ADR-0005: Hosting — pure Cloudflare (Workers + D1 + Access), superseding ADR-0004's Vercel+Supabase line

Status: accepted · 2026-07-03 (operator-decided)

## Context

ADR-0004 chose hosted-personal and named SvelteKit+Supabase+Vercel as "the workspace canonical." The operator's actual infra default is: **Cloudflare unless Vercel is necessary; D1 unless Supabase is necessary** — rally-hq and the photography site are the hybrid exceptions, other sites are pure Cloudflare. The canonical-pattern-first check therefore runs the other way: Supabase/Vercel must justify themselves, and here they can't.

## Why Supabase is not necessary for this product

- **No RLS need**: single user (ADR-0004), and Cloudflare Access authenticates at the edge before the app is reachable — deleting the OTP/auth build entirely, not just simplifying it.
- **No Postgres-only feature in use**: the two PL/pgSQL functions (`upsert_session`, `get_unit_of_work_ledger`) exist because PostgREST caps row reads and lacks server logic — a Worker queries D1 directly with no such cap, so they rewrite as plain app-side SQL. SQLite's `ON CONFLICT` covers the upsert semantics (replace-not-accumulate, per the Stage 3 deviation).
- **Scale**: hundreds of thousands of message rows, aggregation-heavy reads, one writer — comfortably inside D1's envelope (10GB/db).
- The retired platform's "Postgres-only, no SQLite" rule was an enterprise-product constraint (multi-tenant, Cloud SQL path) that died with that pilot.

## Decision

- **Runtime**: SvelteKit on Cloudflare Workers (`adapter-cloudflare`), wrangler-managed.
- **Data**: D1. Migrations ported from the Stage 3 Postgres schema; the two functions become queries in `src/lib/server/`.
- **Auth**: Cloudflare Access in front of the app (operator's email), no in-app auth. The ingest endpoint (`POST /api/v1/ingest`) is exempted from Access and gated by a Bearer API key instead (shipper/importer path — same key model the retired platform proved, SHA-256 at rest).
- **Ingestion**: importers stop talking to the DB directly and POST to the hosted ingest endpoint — which is the ADR-0004 shipper architecture anyway; local dev keeps a direct-D1 fast path via wrangler bindings.
- **Deploy target**: workers.dev subdomain first; mapping quantifai.app (parked, landing archived) is a later, separate decision.
- **Local dev**: `wrangler dev` with local D1 — the Docker Supabase stack requirement disappears.

## Consequences

- ADR-0004's stack line is superseded; its slice definition, salvage map, and single-user posture stand.
- rally-hq's Supabase SSR client pattern (sibling scan) is no longer the auth reference; the relevant references become the workspace's pure-Cloudflare sites and Cloudflare's own Workers/D1 canonical docs.
- If multi-user ever arrives (ADR-0003 KQ-3), revisit: D1's single-writer model and Access-based auth need re-evaluation at that point — recorded now so the future decision isn't silent.
