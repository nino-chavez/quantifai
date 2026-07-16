# Current-state analysis — what exists before this initiative writes any code

Date: 2026-07-03. Two "current states" matter for this pilot: how the operator's employer answers the spend question today (from the stakeholder interview), and what the retired QuantifAI builds already implement (from the 2026-07-03 retrospective's repo-level evidence pass). Citations are to files verified during that pass.

## 1. Employer process today (from `research/sources/stakeholder-interview-2026-07-03-nino-chavez.md`)

- Owner: AI Ops function reporting to the CFO. Interviewee (Product Architect) is adjacent champion, not owner.
- Process: per-provider consoles + hand assembly into docs/spreadsheets. No cross-provider rollup exists.
- Tools in play: Claude Code/Anthropic, GitHub Copilot, Cursor, ChatGPT/OpenAI — all four families. Seat counts not yet captured.
- Demand caveat: **no specific trigger incident** — no named question has yet gone unanswered. Stage 1 must validate local demand, not assume it (see kill-questions in the synthesis doc).

## 2. Inherited code (the retired builds) — what a v1 does NOT need to rebuild

### Telemetry schema and aggregation (quantifai-platform, retired)

- Session/message two-level schema with `org_id` + RLS on every table; `intent_tag` on both levels (`quantifai-platform/supabase/migrations/20260324000000_initial_schema.sql`).
- `upsert_session()` atomic accumulation (partial telemetry compounds, never clobbers) and `get_dashboard_totals()` (`.../20260324000001_functions.sql`).
- Working ingest chain: Bearer-key auth → JSONL normalization → `ON CONFLICT DO NOTHING` dedup → session upsert (`src/routes/api/v1/ingest/+server.ts`, 232 lines, live-debugged against the real shipper).
- Cron rollup `sessions` → `daily_stats` gated by CRON_SECRET, wired in `vercel.json` (`src/routes/api/v1/cron/aggregate/+server.ts`).
- Org/invite-only membership model (`organizations`, `user_roles`, `org_invites`).

### Provider polling and credential handling (quantifai-lite, retired)

- Working BYOK pollers for Anthropic Admin API, OpenAI, OpenRouter (`quantifai-lite/src/lib/providers/{anthropic,openai,openrouter}.ts` — 137/84/85 lines) driven by a Vercel cron (`api/v1/cron/sync-providers`).
- AES-256-GCM credential encryption at rest (`src/lib/crypto.ts`, ported into platform as `src/lib/utils/crypto.ts`).

### Local telemetry shipper (quantifai-sync, alive)

- Go daemon watching `~/.claude/projects` JSONL, batch POST with retry/backoff, cross-platform service install, 20 test files, released v0.1.0 with homebrew tap. Role in this initiative: individual-developer **enrichment** path only — primary ingestion is provider admin APIs (the direction the retired platform's final, unmerged `remove-shipper-references` branch was already taking).

### Known failure modes to not repeat (retrospective, Part 1)

- Credential-storage UI with no data path behind it (platform's `provider_connections` had `last_synced_at` displayed but never written — no poller existed).
- Docs claiming capabilities code doesn't have (Okta documented after deletion; README claiming polling that didn't exist).
- Speculative breadth: 5-role hierarchy with only `admin` checked; 6-provider CHECK constraint with 1 provider's data path.

## 3. Delta between inherited code and the pilot's first screen

The pilot's first screen (org spend rollup: total by provider, trend, budget threshold — interview Q5) needs, beyond what's inherited: (a) per-provider **org-level** pollers against admin/billing APIs (lite's pollers are BYOK personal-scope; org-scope endpoints and auth differ — feasibility sweep pending), (b) a budget-threshold primitive (nothing inherited; the 2026-03-23 design assessment explicitly flagged "budget threshold lines on charts" as an unapplied P0), (c) Copilot and Cursor connectors (never built anywhere — the retired landing claimed them without code). The rest of the screen is assembled from inherited parts.
