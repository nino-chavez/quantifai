# quantifai-next — app

Stage 3 prototype slice (ADR-0004 first shippable slice): a unit-of-work
ledger that prices this very initiative end-to-end on real local data.
SvelteKit 2 + Svelte 5 (runes) + TypeScript + Tailwind v4, Postgres via
Supabase (local dev stack).

See `../../decisions/0004-architecture-posture.md` and `../../prototype/DESIGN.md`
for the architecture and product spec this app implements.

## Setup

```sh
npm install
npx supabase start        # local Docker Postgres + PostgREST; applies supabase/migrations/
cp .env.example .env      # paste the URL/keys `supabase start` printed
```

## Ingest real data

```sh
npm run import:claude     # reads ~/.claude/projects/**/*.jsonl -> sessions/messages/units_of_work
npm run import:git        # reads `git log` for QUANTIFAI_GIT_REPOS -> git_events, time-window joined to sessions
```

Both are idempotent — re-running recomputes from source and upserts.

## Run

```sh
npm run dev                # http://localhost:5173 — the ledger page
```

## Test

```sh
npm run check               # svelte-check + tsc (app + scripts)
npm run lint                 # eslint
npx vitest run                # unit + component tests
npx playwright test           # @smoke e2e (requires supabase running + data imported)
```

## What's here

- `supabase/migrations/` — schema salvaged from quantifai-platform's
  sessions/messages/daily_stats shapes + `upsert_session()`, minus
  org/invite/role tables (single-user, ADR-0004). Adds `units_of_work`,
  `git_events`, and the `cost_provenance` enum.
- `scripts/import-claude-jsonl.ts` — the Claude Code JSONL importer.
- `scripts/import-git-events.ts` — the git-log importer + time-window join.
- `src/lib/adapters/blueprint.ts` — read-only `.blueprint/telemetry.jsonl`
  parser (no dependency on the `blueprint` tool).
- `src/lib/pricing/anthropic-pricing.ts` — the model pricing table (list-price
  token valuation, not a metered bill — see the file header).
- `src/routes/+page.svelte` — the `unit-of-work-ledger` page (DESIGN.md L4).
