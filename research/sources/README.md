# Stage 1 source inputs

Seeded 2026-07-03 from the QuantifAI retrospective (this folder's `retrospective-review-2026-07.md` — canonical copy lives in `quantifai-platform/docs/strategic/`). The retrospective embeds a July-2026 market scan with sourced URLs (Larridin, Torii, Olakai, provider-native dashboards, FOCUS v1.4 status) — reuse it as competitive-analysis input, re-verify anything load-bearing before it lands in a strategy doc.

## Stage 1 is BLOCKED until `pilot_profile.walkthrough_citation` is filled

Per the pilot-profile lock in `blueprint.yml`: a real artifact from a named Commerce.com stakeholder (interview notes, walkthrough of how they answer AI-spend questions today, screenshots of the current process). No artifact → initiative ends at Stage 1 as a documented retire. Do not substitute an imagined user.

## Salvage map (from the retired builds — reuse, don't rebuild)

| Asset | Where |
|---|---|
| Session/message telemetry schema, `intent_tag`, `upsert_session()` atomic accumulation, org/invite governance | `quantifai-platform/supabase/migrations/` (esp. `20260324000001_functions.sql`); concept extraction at `wip/practice/framework/extractions/ai-ops-analytics.md` |
| Go telemetry shipper (tested, released, cross-platform) — individual-developer enrichment path only; primary ingestion is provider admin APIs | `nino-chavez/quantifai-sync` (tap formula still points at pre-transfer `quantifai-app/sync` URLs — fix if kept public) |
| Working provider pollers (Anthropic Admin API, OpenAI, OpenRouter) | `nino-chavez/quantifai-lite` → `src/lib/providers/` |
| Design tokens (warm dark neutrals + gold `#f0c05e`, Space Grotesk/Inter/JetBrains Mono) | `quantifai-lite` tokens; assessment at `tools/forge-brand/references/quantifai-assessment.md` |
| Unapplied P0 design fixes (command palette, semantic chart palette, empty-state pattern) — ready-made Stage 2 input | same assessment doc |

## Sibling-project scan leads (Stage 1 hard gate)

Prior workspace implementations of this initiative's primitives, for the mandatory scan: `rally-hq` (Supabase SSR auth — the pattern platform v2 eventually copied at commit `6857445`), `quantifai-platform` (ingest endpoint + cron aggregation), `quantifai-lite` (BYOK credential encryption, provider polling).
