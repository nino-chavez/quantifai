# DESIGN.md — quantifai-next

Date: 2026-07-03 · Stage 2 artifact, written before any page per METHODOLOGY. Sources: `docs/content/research-comparables.md` (DP-1..6), `research/personas/ai-ops-cfo-owner.md` (JTBD + surfaces), the 2026-03-23 design assessment (`tools/forge-brand/references/quantifai-assessment.md` — unapplied P0s), inherited tokens from quantifai-lite.

## Behavioral rules

Canonical five, product-mapped: **Match the existing product** — greenfield, so "existing product" = the salvaged QuantifAI token set and the stock `@blueprint/ui` portal chrome; no third visual dialect gets invented. **Customer terminology** — rule 2 below. **Savings-first / positive framing** — rule 5 below (honest-positive variant: savings-first where the data supports it, flat statement of breaches). **One primary action per page** — each L4 page has exactly one primary CTA (rollup: "Connect a provider" until ≥1 connection, then none — it's a read surface; drill-down: "Export renewal evidence"; connections: "Add connection"), and each insight card carries exactly one action (rule 4). **Progressive disclosure** — rule 6 below.

1. **Provenance on every dollar (DP-1).** Every cost figure renders with a metered / allocated / unmanaged badge; mixed totals disclose their mix ("$14,210 · 71% metered"). Allocated figures never borrow metered styling. This is the product's credibility spine — it is not a nice-to-have.
2. **Customer terminology — finance-ops, not engineering.** The persona reads spend, budget, seats, utilization, attribution. Tokens, sessions, and models appear only inside drill-downs, always subordinate to a dollar figure. No jargon the owner's month-end report wouldn't contain.
3. **Every view answers "so what" (DP-3).** No spend number without an adjacent trend, utilization, or threshold signal. The rollup's hero number carries direction-vs-prior-month by default.
4. **Insights are cards with one action; evidence is tables underneath (DP-4).** Overlap, dormancy, threshold-breach, unmanaged-spend are cards, each with exactly one CTA. Drill-down grids follow user → model → charge-type → day ordering.
5. **Lead honest-positive.** Savings and coverage framing where the data supports it ("$3,400 reclaimable"), never celebratory chrome over bad news; a threshold breach is stated flat, with the action.
6. **Progressive disclosure.** L4 pages are two levels deep maximum: rollup → drill-down. No 6-level hierarchy (the v1 failure the 2026-03-23 assessment flagged).
7. **Claims match GA (DP-5).** No provider name, connector, or capability appears in UI/copy without a working data path. Unconnected providers render as "not connected," never as empty charts.

## Structural dictionary (L0–L4)

**L0 — tokens** (inherited from quantifai-lite, the salvaged brand): warm dark neutrals (`#0a0a0a` bg, `#131210` surface), gold accent `#f0c05e`/`#e8a735`; Space Grotesk (display) / Inter (body) / JetBrains Mono (numeric); `.metric-number` tabular numerals. Semantic chart palette, formalized per the assessment's P0: **gold = cost (primary), blue = usage, green = savings/reclaimable, red = overage/breach**; provider identity by ordinal neutrals, not brand colors (four vendors' brand palettes would fight the semantic layer).

**L1 — atoms:** metric number; provenance badge (`metered`/`allocated`/`unmanaged` — distinct fill, not color-only, accessibility); trend delta (▲▼ + %); threshold marker (chart rule + label); coverage chip ("71% metered"); connection-status dot.

**L2 — molecules:** metric card (hero number + delta + sparkline); insight card (icon, one-sentence finding, dollar figure, single CTA); provider row (logo-less name, spend, provenance mix, freshness timestamp); dormant-seat row (person, tool, last-active, monthly $).

**L3 — organisms:** spend rollup chart (stacked-by-provider daily/weekly bars + threshold rule + breach shading); provider breakdown table; insight rail (max 4 cards, ranked by dollar impact); drill-down grid (Finout ordering); connections panel (per-provider auth state + last-sync + error surface — `last_sync_error` is user-visible, the retired build's silent-facade failure inverted).

**L4 — pages:** `org-spend-rollup` (the pilot screen: hero total + mix, rollup chart, provider table, insight rail — JTBD-1/2); `per-developer-drilldown` (JTBD-3: utilization + dormancy, provenance-labeled per-dev costs); `settings/connections`. Nothing else in v1. `unmanaged-spend-bucket` is a card on the rollup, not a page, until v1.x.

**Empty states** (assessment P0, standardized): relevant icon + what-will-appear-here explanation + the one action that fills it ("Connect Anthropic — 2 minutes"). Never a bare "No data."

## Testing baseline (day one, per METHODOLOGY)

- CI gate: `tsc --noEmit` + eslint on every push.
- Vitest for non-trivial logic only: provider adapters (normalization), allocation math (seat ÷ headcount with coverage computation), threshold evaluation, crypto round-trip. The `LESSONS-LEARNED.md` bug classes (atomic upsert, `.in()` chunking, NULL-in-UNIQUE, cron-secret inversion) each get a regression test at first touch.
- Playwright `@smoke`: org-spend-rollup renders with seeded data; provenance badges present; connections panel reflects auth state.
- Lighthouse-CI on the two L4 pages; Gitleaks mandatory (provider admin keys are the crown jewels here — appsec checklist R1/R2/R5 apply).

## Architectural invariants

1. **Boundary parsing** — provider payloads are parsed/validated at the adapter boundary (one Zod schema per provider adapter); nothing downstream touches raw provider JSON.
2. **Page metadata** — every prototype page exposes `window.PROTO_PAGE` metadata per the slice-metadata contract (`_meta/<page-id>.json` kept in sync).
3. **Single Providers interface** — all four connectors implement one `Provider` interface (fetch window → normalized rows with provenance); no per-provider special-casing outside its adapter.
4. **One-primary-CTA structural lint** — the one-primary-action rule above is enforced by a structural lint (test asserts ≤1 `data-primary-cta` per rendered page), not by review vigilance.

## Confident preview

The portal is a stakeholder review surface — one confident take per route, not a deliberation venue (per `docs/methodology/confident-preview-rule.md`). Alternatives and rejected options live in the strategy panel citations and ADRs, never as side-by-side UI variants asking the owner to pick.

## Design-system posture

Portal chrome (Pattern A) stays stock `@blueprint/ui`. Product screens use the L0 tokens above as a theme layer — custom tokens, not a custom design system; R-3/R-4 anchor depth beyond this is deliberately deferred (vendor UIs unobservable per `research/competitive/dedicated-vendors.md`; the accessible quality anchors are provider consoles the operator holds seats for, to be captured at Stage 3 if needed).
