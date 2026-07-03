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

## Deterministic commit attribution (git-notes, ADR-0004)

`npm run import:git`'s time-window join ("a commit landed while a session
covering this repo was active") is a guess — it's wrong exactly when several
sessions/worktrees are active in the same repo at once. The
`quantifai-post-commit` hook removes the guess: it writes a git note under
`refs/notes/quantifai` naming the exact session for every commit made while
the hook is installed, and the importer prefers that note over the
time-window join whenever one exists.

Install once per repo (works for the main checkout and every linked
worktree, present and future, from a single install — see
`scripts/install-git-hook.ts`'s header for why):

```sh
npm run hooks:install -- /path/to/repo [/path/to/another-repo ...]
```

Session-id resolution ladder (first hit wins, each rung recorded as the
note's `source`): (a) `$CLAUDE_SESSION_ID`/`$CLAUDE_CODE_SESSION_ID` env var
— set when the commit runs inside a Claude Code Bash tool call; (b) the
repo's live session heartbeat lock (`<git-common-dir>/.claude-sessions/*.json`,
written by the operator's worktree-guard hooks) — the freshest lock whose
`cwd` + `branch` match this commit; (c) neither resolves -> no note, the
commit falls back to the time-window join at import time exactly as before.
Full mechanism + empirical findings: `hooks/quantifai-post-commit`.

**Limitations (v1, deliberate):**
- **Local-only.** Git notes do NOT travel with `git clone`/`git push` unless
  pushed explicitly. A fresh clone (or a machine that never ran the hook)
  has zero notes — all its history reads as `time_window`, honestly, not as
  an error. To carry notes to another clone/machine:
  ```sh
  git push origin refs/notes/quantifai
  # on the other clone:
  git fetch origin refs/notes/quantifai:refs/notes/quantifai
  ```
  No shipper/sync daemon exists for this yet — it's a manual escape hatch,
  not automated.
- **Never regresses.** Once a commit is linked via a note (`link_method =
  'git_notes'`), a later re-import can only ever upgrade or preserve that
  link, never fall back to a `time_window` guess for the same commit — see
  `src/lib/importers/git-event-upsert-sql.ts`.

## Configure subscription amortization (the honest second number)

Every cost is `estimated` (list-price API-equivalent) until you record your
actual subscription plan fee — there is no fabricated default. Record it with:

```sh
npm run seed:plan -- --provider anthropic --plan "Claude Max" \
  --fee 200 --from 2026-01-01 [--to 2026-06-30] [--local]
```

Until a plan is recorded, the ledger and practice-numbers pages render an
explicit "amortization unconfigured — set your plan fee" empty state instead
of a $0. See `src/lib/pricing/amortization.ts` for the usage-share method.

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

Canonical hostname is **app.quantifai.app** (custom domain on the
`quantifai-app` Worker, `quantifai.app` zone). `quantifai-app.biq.workers.dev`
stays live as a fallback — both hostnames route to the same Worker and carry
identical Cloudflare Access coverage (see below), so either works; switch
`QUANTIFAI_API_URL` to the custom domain when convenient (see
`.env.example`).

Both hostnames sit behind Cloudflare Access (Zero Trust org
`quantifai-next.cloudflareaccess.com`, OTP IdP for the operator email), with
two Access applications extended to cover both domains:
- **`quantifai-app — ledger`** — allow policy (operator email + service
  token) covering the app root on both `app.quantifai.app` and
  `*.biq.workers.dev`.
- **`quantifai-app — ingest/health (bypass)`** — bypass policy covering
  `/api/v1/*` on both hostnames (the ingest endpoint is Bearer-key gated
  in-app, not by Access).

Adding a hostname to the Worker without first extending both Access
applications would serve the ledger unauthenticated — always confirm Access
coverage for a new hostname before attaching it as a custom domain in
`wrangler.jsonc`.

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
- `scripts/import-git-events.ts` — the git-log importer: reads local
  `refs/notes/quantifai` notes (deterministic linkage) and falls back to the
  server-side time-window join in remote mode for anything un-noted.
- `hooks/quantifai-post-commit` + `scripts/install-git-hook.ts` — the
  git-notes attribution hook and its installer (see "Deterministic commit
  attribution" above).
- `src/routes/api/v1/ingest/+server.ts` — Bearer-key-gated ingest endpoint.
- `src/routes/api/v1/health/+server.ts` — unauthenticated liveness probe.
- `src/lib/adapters/blueprint.ts` — read-only `.blueprint/telemetry.jsonl`
  parser (no dependency on the `blueprint` tool).
- `src/lib/pricing/anthropic-pricing.ts` — the model pricing table (list-price
  token valuation, not a metered bill — see the file header).
- `src/routes/+page.svelte` — the `unit-of-work-ledger` page (DESIGN.md L4),
  gated by Cloudflare Access in production (see the initiative's final
  report for the Access application config).
- `src/routes/practice-numbers/` — the `practice-numbers` page (DESIGN.md L4,
  JTBD-3): per-project/initiative cost+output and practice-level rates
  (commits/merges/sessions/cost per week) over a 30/90/all-time window, with
  an "Export numbers" CTA that downloads markdown + CSV. Deploys/week
  renders "not instrumented" honestly rather than proxying merges as deploys.
- `src/lib/pricing/amortization.ts` — subscription-amortization math (usage-
  share apportionment of a plan fee across a calendar month's sessions).
- `scripts/seed-subscription-plan.ts` — records the operator's real plan fee
  into `subscription_plans` (never fabricated — see above).
