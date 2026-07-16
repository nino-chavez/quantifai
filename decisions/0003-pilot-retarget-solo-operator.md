# ADR-0003: Pilot re-target — AI Ops/CFO at the employer (de-named) → solo operator pricing their own practice

Status: accepted · 2026-07-03

## Context

ADR-0002 targeted the AI Ops function reporting to the CFO at the employer, with an explicit kill-gate: Stage 3 blocked until that owner gave a direct walkthrough. The operator has now stated the disqualifier plainly: "we won't get feedback from commerce. i'm on my own here." KQ-a (owner walkthrough) fails permanently, not provisionally. Per ADR-0002's own terms, the enterprise-internal pilot retires. This is the gate working — the retrospective's verdict priced this outcome at one research stage, and that price was paid.

## Decision

Re-target the pilot to the **solo AI-heavy operator pricing their own practice** (`solo-operator-practice-pricing`), with the operator himself as user #0 — a first-party stakeholder, not a proxy.

**The lens (operator-confirmed in-session):** cost and output per **unit of work** — initiative, project, session — not spend per calendar month. "This initiative cost $X across N sessions and produced Y commits/deploys." Provider becomes a dimension; the unit of work is the headline.

**Why this pilot survives the scrutiny that killed the last two:**
1. The walkthrough citation is real and first-party: the 2026-07-03 working session itself (two multi-agent fan-outs, nine subagents, operator instruction to "fan out to cheaper faster models," and no way to price any of it), plus two standing artifacts — the positioning one-pager's empty `[fill in]` metric brackets (2026-04-19, still empty) and the Blueprint cost dial's own admission that `duration_ms` telemetry "is NOT a token-cost proxy" (methodology ADR-0003). See `research/sources/walkthrough-2026-07-03-user0-practice-pricing.md`.
2. The feasibility inversion favors it: enterprise admin APIs (Cursor Enterprise-gated, ChatGPT Compliance) leave scope entirely; the local shipper (quantifai-sync — the strongest salvage) and lite's BYOK pollers become the core architecture rather than the fallback.
3. Distribution matches operator capacity: blog/GitHub/HN, channels already operating — not enterprise sales, the muscle the retired builds never had.

**The risk this ADR does not hide:** this pivot re-enters quantifai-lite's audience, and lite got zero users. The differentiation requirement is therefore explicit: the product competes at the unit-of-work + output-pairing grain, where ccusage (cost-per-month, Claude-only, output-blind) and provider dashboards (single-provider) do not play. If the solo-market sweep shows that grain already covered, the initiative retires — that is the re-derived KQ-c.

**Sequencing:** solo operator is the pilot; small team (2–20) is a growth path the existing `org_id` schema already supports, deliberately not the pilot — leading with teams re-imports the auth/org speculation that bloated the retired platform. Billing/margin for agencies is the revenue hypothesis (same primitive: cost-per-unit-of-work = billable line), tested after dogfood signal, not before.

## Downstream re-derivation (executed with this ADR)

- `blueprint.yml pilot_profile` — replaced; competitors re-derived (ccusage, provider-native usage surfaces, Helicone-class API trackers) — Larridin/Torii/Olakai/Finout move to context, no longer competitors of record.
- `research/personas/` — `ai-ops-cfo-owner.md` deleted (superseded; recoverable from git), replaced by `solo-operator.md`.
- `research/funnel/` — internal-adoption ladder replaced by dogfood → publish → signal → agency-revenue ladder.
- `research/competitive/solo-market.md` — new sweep. Surviving unchanged: `provider-api-feasibility.md` (the personal-scope rows), `analogous-industries.md` patterns 1/2/5 (normalization, showback framing, FOCUS-aligned naming), the full sibling scan.
- `prototype/DESIGN.md` — re-weighted: first screen becomes the unit-of-work ledger; vocabulary shifts finance-ops → operator; provenance categories become subscription-amortized / API-metered / estimated.
- `docs/content/research-comparables.md` — re-target addendum appended; enterprise-buyer conclusions marked historical.

## Kill-questions, re-derived

- KQ-1: does the solo-market sweep show the unit-of-work + output grain already served? → retire.
- KQ-2: after 30 days of dogfood, has the instrument changed a real decision (model routing, plan choice, an initiative go/no-go) at least once? → if not, park; it's a curiosity dashboard.
- KQ-3: does publishing the dogfood produce any external pull (issues, stars, waitlist, "how do I run this")? → gates any agency/billing investment.
