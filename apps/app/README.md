# quantifai — app

The QuantifAI ledger, live at quantifai.app: the unit-of-work ledger, the
practice-numbers page, the public landing and the ingest API.
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

Day to day, the [`quantifai-sync`](https://github.com/nino-chavez/quantifai-sync)
agent ships Claude Code usage and commits as they happen. The importers here
are for backfills and for sources the agent does not read.

Three importers:

- `npm run import:claude` (`scripts/import-claude-jsonl.ts`): Claude Code
  JSONL session files.
- `npm run import:git` (`scripts/import-git-events.ts`): git commits.
- `npm run import:codex` (`scripts/import-codex-rollouts.ts`): Codex
  rollouts under `~/.codex`, priced from `openai-pricing.ts`. Remote only;
  `--dry-run` prints totals without sending. Usage is in the script's header.

```sh
# Default: POST to the deployed ingest endpoint.
# Requires QUANTIFAI_API_URL + QUANTIFAI_API_KEY (see .env.example).
npm run import:claude
npm run import:git
npm run import:codex

# --local (Claude and git importers): write directly to the local D1 file via
# `wrangler d1 execute`, no deployed endpoint or API key needed.
npm run import:claude -- --local
npm run import:git -- --local
```

All three are idempotent — re-running recomputes from source and upserts.

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
- **Read where the commit was made.** Git notes do NOT travel with
  `git clone`/`git push` unless pushed explicitly. The `quantifai-sync`
  agent does not need them to: it reads each queued commit's note on the
  machine that made the commit and sends the note's session id with that
  commit (`internal/git/sender.go`, `noteSessionID`). A clone or machine
  that never ran the hook has no notes, so its history reads as
  `time_window`, honestly, not as an error. To carry notes to another clone
  for `npm run import:git`:
  ```sh
  git push origin refs/notes/quantifai
  # on the other clone:
  git fetch origin refs/notes/quantifai:refs/notes/quantifai
  ```
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

Canonical **human** hostname is **quantifai.app** (single hostname, path
routes — consolidation of 2026-07-04): `/` is the public landing, `/ledger`
and `/practice-numbers` are the Access-gated operator surfaces, `/api/v1/*`
carries in-app auth under an Access bypass. Zone routes + explicit proxied
A/AAAA records, deliberately NOT a Workers custom domain (the managed
record served AAAA-only with zero A answers, breaking IPv4 clients; found
2026-07-03). The apex/www DNS records still CNAME to the retired
`quantifai-landing.pages.dev` Pages project — the Worker routes shadow it,
and removing them from `wrangler.jsonc` is the instant rollback.

**app.quantifai.app no longer exists** (removed 2026-07-04 — no users
existed to need a redirect): no route, no DNS records, no Access coverage.
It briefly existed during the 2026-07-03 consolidation; nothing references
it.

**Which host takes POSTs.** The `quantifai.app` zone carries a security rule
(landing-era, unreadable with current API tokens) that serves a Cloudflare
block page (403) on most POSTs. `quantifai-app.biq.workers.dev` is
off-zone and takes every POST. Probed on 2026-11-19 with a made-up key and
an empty body:

| POST | `quantifai.app` | workers.dev |
|---|---|---|
| `/api/v1/ingest` with an `Authorization` header | reaches the Worker (401) | reaches the Worker (401) |
| `/api/v1/ingest` with no `Authorization` header | block page (403) | reaches the Worker (401) |
| `/api/v1/sync-providers`, even with a key | block page (403) | reaches the Worker (401) |
| `/api/v1/waitlist`, as the landing form sends it | block page (403) | reaches the Worker (400) |

So:

- The `quantifai-sync` agent defaults `api_url` to the apex. Its ingest
  POSTs carry the key, so they pass; this Mac's agent ships there.
- The importers' `QUANTIFAI_API_URL` (`.env.example`) and manual
  `/api/v1/sync-providers` calls use workers.dev.
- The landing's waitlist form posts cross-origin to workers.dev. The
  waitlist endpoint sets CORS headers for the `quantifai.app`/`www` origins
  for exactly this.

The rule is not readable, so this table is what was observed, not what the
rule says. If an apex POST ever answers with an HTML block page, point that
client at workers.dev. If the rule is removed (dashboard: Security → WAF →
custom rules), the split can collapse to one hostname. The landing keeps a
same-origin fallback, so it needs no code change.

Access (Zero Trust org `quantifai-next.cloudflareaccess.com`, OTP IdP for
the operator email), two applications:
- **`quantifai-app — ledger`** — allow policy (operator email + service
  token) covering `quantifai-app.biq.workers.dev` (whole host) plus the
  path-scoped destinations `quantifai.app/ledger*` and
  `quantifai.app/practice-numbers*`. The apex root (landing) and its
  assets are deliberately NOT covered — the landing is public.
- **`quantifai-app — ingest/health (bypass)`** — bypass policy covering
  `/api/v1*` on workers.dev and `quantifai.app` (the ingest endpoint is
  Bearer-key gated in-app, not by Access).

Adding a gated path/hostname to the Worker without first extending the
Access applications would serve the ledger unauthenticated — always confirm
Access coverage BEFORE the routing change deploys.

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
- `scripts/import-codex-rollouts.ts` — the Codex rollout importer.
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
- `src/routes/+page.svelte` — the public landing page (root route on every
  host): live proof strip from `/api/v1/public-stats`, honesty block, and
  the Turnstile-verified waitlist form (`/api/v1/waitlist`, POSTed
  cross-origin to workers.dev — see "Deploy" above for why).
- `src/routes/ledger/` — the `unit-of-work-ledger` page (DESIGN.md L4),
  gated in production by the path-scoped Cloudflare Access destination
  `quantifai.app/ledger*` (see "Deploy" above).
- `src/routes/practice-numbers/` — the `practice-numbers` page (DESIGN.md L4,
  JTBD-3): per-project/initiative cost+output and practice-level rates
  (commits/merges/sessions/cost per week) over a 30/90/all-time window, with
  an "Export numbers" CTA that downloads markdown + CSV. Deploys/week
  renders "not instrumented" honestly rather than proxying merges as deploys.
- `src/lib/pricing/amortization.ts` — subscription-amortization math (usage-
  share apportionment of a plan fee across a calendar month's sessions).
- `scripts/seed-subscription-plan.ts` — records the operator's real plan fee
  into `subscription_plans` (never fabricated — see above).
