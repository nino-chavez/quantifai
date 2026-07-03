# quantifai-next — app

Stage 3 prototype slice (ADR-0004 first shippable slice): a unit-of-work
ledger that prices this very initiative end-to-end on real local data.
SvelteKit 2 + Svelte 5 (runes) + TypeScript + Tailwind v4, on Cloudflare
Workers + D1 (ADR-0005 — pure Cloudflare, superseding the Supabase/Vercel
line).

See `../../decisions/0004-architecture-posture.md`,
`../../decisions/0005-hosting-pure-cloudflare.md`, and `../../prototype/DESIGN.md`
for the architecture and product spec this app implements.

## Setup

```sh
npm install
npm run db:migrate:local   # applies migrations/*.sql to the local D1 file
```

No Docker, no Supabase CLI — `wrangler`'s local D1 is a SQLite file under
`.wrangler/state/v3/d1`.

## Ingest real data

Two modes (`scripts/import-claude-jsonl.ts`, `scripts/import-git-events.ts`):

```sh
# Default: POST to the deployed ingest endpoint.
# Requires QUANTIFAI_API_URL + QUANTIFAI_API_KEY (see .env.example).
npm run import:claude
npm run import:git

# --local: write directly to the local D1 file via `wrangler d1 execute`,
# no deployed endpoint or API key needed.
npm run import:claude -- --local
npm run import:git -- --local
```

Both are idempotent — re-running recomputes from source and upserts.

## Run

```sh
npm run dev                 # http://localhost:5173 — vite dev; platform.env.DB
                             # is emulated against the local D1 file (adapter-
                             # cloudflare's platformProxy reads wrangler.jsonc)
npm run preview             # builds, then runs the real Worker via `wrangler dev`
```

## Deploy

```sh
npm run deploy               # vite build && wrangler deploy
npm run db:migrate:remote    # applies migrations/*.sql to the hosted D1 database
wrangler secret put INGEST_API_KEY_HASH   # SHA-256 hex of the ingest Bearer key
```

## Test

```sh
npm run check                # svelte-check + tsc (app + scripts)
npm run lint                  # eslint
npx vitest run                 # unit + component tests
npx playwright test             # @smoke e2e — builds and runs against `wrangler dev`
```

## What's here

- `migrations/` — D1 (SQLite) schema, ported from the retired Postgres
  schema's sessions/messages/daily_stats shapes. The two Postgres functions
  (`upsert_session`, `get_unit_of_work_ledger`) are now plain SQL in
  `src/lib/server/` — a Worker queries D1 directly with no PostgREST row
  cap, so no RPC indirection.
- `scripts/import-claude-jsonl.ts` — the Claude Code JSONL importer.
- `scripts/import-git-events.ts` — the git-log importer (server does the
  time-window join in remote mode).
- `src/routes/api/v1/ingest/+server.ts` — Bearer-key-gated ingest endpoint.
- `src/routes/api/v1/health/+server.ts` — unauthenticated liveness probe.
- `src/lib/adapters/blueprint.ts` — read-only `.blueprint/telemetry.jsonl`
  parser (no dependency on the `blueprint` tool).
- `src/lib/pricing/anthropic-pricing.ts` — the model pricing table (list-price
  token valuation, not a metered bill — see the file header).
- `src/routes/+page.svelte` — the `unit-of-work-ledger` page (DESIGN.md L4),
  gated by Cloudflare Access in production (see the initiative's final
  report for the Access application config).
