# ADR-0004: Architecture posture — greenfield+salvage, hosted-personal, standalone with Blueprint adapter

Status: accepted · 2026-07-03 (operator-decided)

## Decisions

**1. Greenfield with salvage-by-copy, not refactor.** The retired repos are architected for retired pilots — platform for multi-tenant enterprise (org/invite/5-role burden), lite as a public free product. The differentiating layer (cost↔output pairing) exists in neither, so there is nothing to refactor toward it. Salvage follows the sibling scan's copy/adapt/ignore verdicts (`research/current-state/sibling-project-scan.md`).

**2. Hosted-personal app.** Operator override of the local-first recommendation, for a concrete reason: the practice runs on two laptops against the same repos, and per-machine local stores can't answer a unit-of-work question that spans machines. Collation is the requirement; a hosted store is the mechanism. Privacy posture holds because the deployment is personal infrastructure (operator's own Vercel + Supabase), not a multi-tenant SaaS — data lives in accounts the operator already controls.

Consequences:
- **quantifai-sync regains its core role.** The Go shipper (daemonized JSONL watcher, cross-platform service install, retry/backoff — the strongest engineering salvage) runs per machine and POSTs to the hosted ingest. Its existing git-hook subsystem (`internal/git/`, `cmd git init/hook-post-commit`) and editor-events endpoint are the natural carriers for the output-pairing signal (Exceeds Ink git-notes mechanism as the reference).
- **The platform's ingest chain salvages near-verbatim**: `POST /api/v1/ingest` (Bearer key, chunked dedup), `upsert_session()`, `daily_stats` cron — plus lite's BYOK pollers for API-side spend (Anthropic/OpenAI/OpenRouter), which hosted crons can run again (Vercel cron, per the canonical stack).
- **Stack**: SvelteKit + Supabase + Vercel — the workspace canonical (rally-hq SSR client pattern per the sibling scan; operator's standard Vercel account flow).
- **Auth is single-user**: Supabase OTP for one operator. The org/invite/role tables from the platform schema are explicitly NOT salvaged — multi-user re-enters only if ADR-0003 KQ-3 (external pull) fires. Carrying that schema now would repeat the retired build's speculative-breadth failure.
- The solo-market sweep's "evaluate ccusage as substrate" note narrows: ccusage is a per-machine CLI and can't collate; the shipper is the collection layer. The posture against rebuilding breadth stands — v1 sources are exactly what the pilot needs: Claude Code JSONL (both machines), git events, BYOK API-spend pollers. No Cursor/Copilot readers until a JTBD demands them.

**3. Standalone product with a one-directional Blueprint adapter.** Blueprint stays the emitter of unit-of-work boundaries (`.blueprint/telemetry.jsonl`: initiative/stage/wave, duration-only by its own ADR-0003 admission); quantifai-next prices them by joining that telemetry against session cost data. Quantifai understands Blueprint's format; Blueprint never depends on quantifai. Folding into the methodology repo is rejected because it kills the product (unsellable to non-Blueprint users) and violates Blueprint's own scope-ceiling charter pattern (its ADR-0004 refuses to own identity; cost telemetry deserves the same refusal). Non-Blueprint boundary emitters (git repos, project paths) are first-class for the same reason — the tool must work for operators who don't run the methodology.

## Interlock

Hosted-personal is why the shipper and the platform's ingest chain move from "context" back to "core salvage." Greenfield is still right despite that overlap because the salvage is parts (routes, functions, pollers), not the repos' product shape (multi-tenant enterprise / public free tier). Standalone-with-adapter is why the Blueprint integration is a telemetry parser, not a merge.

## First shippable slice (Stage 3 target, per DESIGN.md L4)

`unit-of-work-ledger` fed end-to-end: shipper on both laptops → hosted ingest → sessions joined to projects/initiatives → ledger with provenance mix and cost-vs-output strip. First test case: price the quantifai-next initiative itself.
