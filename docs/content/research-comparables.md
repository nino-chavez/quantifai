# Research comparables — quantifai-next Stage 1 synthesis

Date: 2026-07-03 · Synthesizes four sweeps (provider-API feasibility, dedicated vendors, analogous industries, sibling-project scan) + the proxy stakeholder interview. Source docs: `research/competitive-analysis/{provider-api-feasibility,dedicated-vendors,analogous-industries}.md`, `research/current-state/{codebase-analysis,sibling-project-scan}.md`, `research/sources/stakeholder-interview-2026-07-03-nino-chavez.md`.

## Kill-question status (from ADR-0002 / interview open questions)

| # | Kill question | Status | Evidence |
|---|---|---|---|
| KQ-a | AI Ops owner declines a walkthrough | **OPEN — operator task.** Blocks Stage 3 investment, not Stage 2 planning. | Interview is proxy-only; owner is "AI Ops that reports to CFO" |
| KQ-b | Provider APIs can't deliver per-developer cost cleanly | **PASS with constraints.** Org rollup: 4/4 providers API-feedable (ChatGPT Enterprise *seat* spend needs CSV/invoice). Real per-dev $: 2/4 (Anthropic, Cursor-Enterprise); Copilot/ChatGPT per-dev is allocation. | `provider-api-feasibility.md` |
| KQ-c | A vendor already nails it | **NO — with one verification flag.** None of Larridin/Torii/Olakai/Finout demonstrably ships cross-provider per-dev seat+token; DX's claim is closest and must be fact-checked (Stage 4) before any strategy doc calls the gap open. | `dedicated-vendors.md` |
| KQ-d | No budget-line pain at Commerce.com | **OPEN.** Interview: no trigger incident — demand is anticipated. Test directly in the owner walkthrough (does the CFO org track AI spend as a budget line?). | Interview Q4 |

Net Stage 1 posture: research supports proceeding to Stage 2 (Design Principles) now; Stage 3 (prototype build) is gated on KQ-a/KQ-d — the owner walkthrough resolves both.

## Patterns by category (adopt/reject with owners)

### Data architecture
- **Adapter-per-provider normalization layer** (TEM precedent; the product is impossible without it) — ADOPT, build first. API feeds over CSV, CSV over nothing (TEM's EDI>paper ranking).
- **FOCUS-dimension-aligned schema, zero FOCUS plumbing** (v1.4 ratified 2026-06 but no provider emits it; validators Q3) — ADOPT naming only.
- **Inherited telemetry core** — session/message two-level schema, `upsert_session()` atomicity, org/invite scoping, `daily_stats` rollup cron (quantifai-platform, "proven in quantifai-lite" per in-code comment) — ADOPT via copy, with `LESSONS-LEARNED.md` as pre-flight checklist and `appsec-review-v2.md` risks (static CRON_SECRET, invite domain allowlist, key rotation) as the security checklist.
- **Local shipper as enrichment, not core** — provider APIs are primary; quantifai-sync only for per-session depth no API exposes — ADOPT (this ratifies the retired platform's final unmerged pivot).

### Cost semantics (the credibility layer)
- **Metered vs allocated vs unmanaged provenance on every dollar** — ADOPT as a hard rule. Only Anthropic + Cursor yield metered per-dev $; Copilot/ChatGPT per-dev is seat-price allocation; expense-matched shadow spend is unmanaged. Rendering these as equivalent is the Larridin grain-vagueness failure and the retired landing's over-claim failure in new clothes.
- **Showback default, chargeback behind a coverage gate** (FinOps: 57% of mature orgs run showback primary; ~90% attribution coverage before chargeback is dispute-proof) — ADOPT.

### CFO surface
- **Insight cards over tables**: Torii's overlap-detection ("redundant Claude Code+Copilot+Cursor spend = $X") — ADOPT as first-class.
- **Utilization + 30-day dormancy flag, dollar-framed** ("$X/month on N dormant seats"; Zylo benchmarks: 54% industry utilization, 90%+ best-in-class) — ADOPT.
- **Cost-to-outcome pairing** (Olakai: spend vs PR cycle time) — ADAPT for v2; v1 pairs spend with utilization (cheaper, same "so what" function). Full outcome metrics drift toward DX's territory and the out-of-scope productivity-ROI buyer.
- **Unmanaged-spend bucket from expense keyword match** — ADOPT scoped-down (60% of shadow-IT value, fraction of Torii's build).

### Rejected
- Full SSO/browser-extension shadow-IT correlation (multi-quarter build), FOCUS export pipeline (no emitters), compliance-led positioning (no mandate exists — EU AI Act/ISO 42001 inventory AI *systems*, not spend), presence-detection as cost metering (Torii), framework-as-feature copy (Finout), per-developer claims without metered data (Larridin).

## Cross-cutting patterns

1. **The absence of screenshots is the market gap.** No vendor across five (incl. DX) shows a real cross-provider per-developer seat+token table — and the feasibility sweep explains why: the underlying APIs only make it honest for 2 of 4 providers. Whoever solves the Copilot/ChatGPT allocation problem *transparently* (labeled allocation, not fake precision) ships the first credible version of this screen.
2. **Every failed pattern here is a claims-ahead-of-data pattern** — Torii's presence-as-metering, Larridin's grain-vagueness, Finout's framework blogging, and the retired QuantifAI landing. The competitive moat for an internal tool is credibility discipline, which costs process (Stage 4), not engineering.
3. **Convergent module shape**: every vendor lands on rollup → drill-down → utilization/reclaim → shadow-detection. This is the category's settled IA; differentiation is grain honesty and CFO framing, not module invention.

## Distinctive-to-one-anchor

- Only **Finout** has a verified per-user API integration (Cursor). Only **Olakai** pairs cost with an engineering outcome. Only **Torii** dollarizes tool overlap. Only **DX** claims all-three coding tools unified (unverified). Nobody owns "honest provenance labeling" — unclaimed.

## Recommended Design Principles for Stage 2 (DP-N)

- **DP-1 Provenance on every dollar.** Each cost figure carries metered / allocated / unmanaged provenance, visually distinct; totals disclose their mix. Never imply metered precision for allocated numbers.
- **DP-2 Showback by default.** Chargeback is a mode, gated on attribution coverage ≥90%; the UI shows the coverage number itself.
- **DP-3 Every view answers "so what."** No spend figure renders without an adjacent utilization or trend signal; the target user (CFO-side AI Ops) acts on waste and anomaly, not on curiosity.
- **DP-4 Insights are cards with one action; evidence is tables underneath.** Overlap, dormancy, threshold-breach, and unmanaged-spend are cards; drill-downs use Finout's user → model → charge-type → day ordering.
- **DP-5 Claims match GA.** UI copy, docs, and any landing never name a provider/capability without a working data path behind it (retired-build failure; Stage 4 enforces).
- **DP-6 Schema names align to FOCUS dimensions** (ChargeCategory, PricingUnit, CommitmentDiscountStatus) for free forward-compatibility.

## Reference grading table

Track: **Convention** (what the ecosystem does / vendor-asserted capability) vs **Quality** (independent evidence of what works) vs **Both**.

| Reference | Track | Basis |
|---|---|---|
| Provider API docs (Anthropic, GitHub, Cursor, OpenAI) | Both | Primary capability ground truth (convention) + verified against fetched schemas (quality of evidence high; two OpenAI pages snippet-sourced — flagged) |
| FinOps Foundation / CloudZero showback-chargeback data | Quality | Practitioner survey data (57/18/25 split, 90% coverage gate) |
| Zylo SaaS Management Index | Quality | Longitudinal survey (utilization 47%→54%) |
| CloudEagle 30-day reclaim threshold | Convention | Practice pattern, vendor-published |
| TEM sources (Tangoe, Sociumit) | Convention | Category-pattern description, vendor-published |
| FOCUS v1.4 spec (finops.org) | Both | Ratified standard text |
| Larridin / Olakai product pages, Torii AI Dashboard page | Convention | Vendor-claimed, no independent verification (Olakai/Larridin have zero G2/Gartner presence) |
| Torii & Finout G2/Gartner listings | Quality | Third-party reviews — but for their *legacy* products, not the AI modules |
| DX AI cost report blog | Convention | Vendor-claimed; fact-check target |
| quantifai-platform/lite code + `LESSONS-LEARNED.md` + `appsec-review-v2.md` | Both | First-party shipped code, bugs found and fixed under load |

No quality claim in this synthesis rests on a convention-only reference: the two load-bearing quality claims (showback prevalence, utilization benchmarks) cite FinOps Foundation and Zylo survey data; all vendor capability statements are labeled vendor-claimed.

## Re-target addendum (2026-07-03, ADR-0003) — read before citing anything above

The pilot re-targeted same-day from `commerce-ai-ops-cfo` to `solo-operator-practice-pricing` (disqualifier: owner unreachable; KQ-a failed permanently). Effect on this synthesis:

- **Historical (enterprise-buyer conclusions):** the dedicated-vendor kill-question verdict (Larridin/Torii/Olakai/Finout), the CFO-surface patterns (seat dormancy, showback/chargeback gating), and the enterprise rows of the feasibility table. Kept for the record and for the agency revenue hypothesis later; not competitors of record for the pilot.
- **Surviving unchanged:** the sibling scan (inheritance map improves — shipper promotes to core), the normalization-layer pattern, FOCUS-aligned schema naming (DP-6), provenance discipline (DP-1, categories re-derived as subscription-amortized/API-metered/estimated), claims-match-GA (DP-5), insight-cards-over-tables (DP-4), the "absence of screenshots is the market gap" finding — which now reads at the unit-of-work grain.
- **Superseded kill-questions:** KQ-a/KQ-d (owner walkthrough/demand) resolve via the first-party walkthrough; new KQ-1/2/3 defined in ADR-0003 (grain already served? / decision-changing within 30 days? / external pull?).
- **New competitive leg:** `research/competitive/solo-market.md` (ccusage, provider-native personal surfaces, OpenRouter, Helicone-class) — the competitors of record for this pilot.

## Handoff to Stage 2

Inputs ready: DP-1..6 above, the pilot's first screen (org spend rollup + trend + threshold, interview Q5), inherited component inventory (sibling scan), Finout grid ordering, insight-card list. Pending operator tasks carried forward: (1) AI Ops owner walkthrough (KQ-a/KQ-d — gates Stage 3), (2) live Copilot per-user billing test on a Business/Enterprise org (decides Copilot drill-down grain), (3) confirm Commerce.com's Cursor plan tier (Enterprise-gated APIs), (4) Stage 4 fact-check of DX's actual grain.
