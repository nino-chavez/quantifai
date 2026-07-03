# ADR-0006: Provider credentials — Worker secrets, not a BYOK credential table

Status: accepted · 2026-07-03 (slice 3, provider-cost pollers)

## Context

The sibling scan (`research/current-state/sibling-project-scan.md`) documents
`quantifai-lite`'s poller architecture: `provider_connections`, an
AES-256-GCM-encrypted credential table, one row per (user, provider) —
the standard BYOK ("bring your own key") shape for a multi-tenant product
where each org/user supplies and rotates their own provider API keys
through the app's own UI.

## Decision

quantifai-next does not build this. Provider credentials
(`ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY`, `OPENROUTER_API_KEY`)
are Cloudflare Worker secrets (`wrangler secret put`), read directly from
`platform.env` by each adapter in `src/lib/providers/`. No credential
table, no encryption-at-rest code path, no in-app "add connection" flow.

## Why

ADR-0005's single-user posture already deleted the org/invite auth layer;
a BYOK table exists to let *multiple* tenants each hold their own
encrypted key, retrievable and rotatable through product UI. With exactly
one operator and one set of provider accounts, a Worker secret **is** the
credential store — Cloudflare encrypts it at rest, scopes it to the
Worker, and the "rotate a key" operation is `wrangler secret put` run
once, not a UI feature to build and test.

Building the BYOK table anyway would mean: an encryption module (AES-GCM
key management — where does *that* key live? Another Worker secret,
making the DB layer pure overhead), a settings UI to collect/redact/rotate
keys, and a runtime indirection (`env` -> DB lookup -> decrypt -> use)
in place of `env.ANTHROPIC_ADMIN_API_KEY` — for a product with one
consumer of that credential, ever, per the ADR-0004/0005 lineage.

## Consequences

- The `settings/connections` page (DESIGN.md L4, not yet built) will read
  connection state from `provider_sync_state` (migrations/0004) — populated
  by the sync orchestrator, not by a credential table — and will have no
  "add connection" form; adding a provider is an operator running
  `wrangler secret put` and redeploying.
- If quantifai-next ever goes multi-user (ADR-0005's own revisit trigger,
  ADR-0003 KQ-3), this decision is revisited together with D1's
  single-writer model and Access-based auth — a BYOK table becomes
  necessary at that point, not before.
