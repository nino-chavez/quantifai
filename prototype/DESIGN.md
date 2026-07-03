# DESIGN.md — quantifai-next

Date: 2026-07-03 · Stage 2 artifact, written before any page per METHODOLOGY. Re-weighted same day for the ADR-0003 pilot re-target (solo operator, unit-of-work lens). Sources: `docs/content/research-comparables.md` (DP-1..6 + re-target addendum), `research/personas/solo-operator.md` (JTBD + surfaces), the 2026-03-23 design assessment (`tools/forge-brand/references/quantifai-assessment.md` — unapplied P0s), inherited tokens from quantifai-lite.

## Behavioral rules

Canonical five, product-mapped: **Match the existing product** — greenfield, so "existing product" = the salvaged QuantifAI token set and the stock `@blueprint/ui` portal chrome; no third visual dialect gets invented. **Customer terminology** — rule 2 below. **Savings-first / positive framing** — rule 5 below (honest-positive variant: savings-first where the data supports it, flat statement of overruns). **One primary action per page** — each L4 page has exactly one primary CTA (ledger: "Point at your sessions" until first ingest, then none — it's a read surface; routing-calibration: "Re-anchor cost dial"; practice-numbers: "Export numbers"; connections: "Add connection"), and each insight card carries exactly one action (rule 4). **Progressive disclosure** — rule 6 below.

1. **Provenance on every dollar (DP-1).** Every cost figure renders with a **subscription-amortized / API-metered / estimated** badge; mixed totals disclose their mix ("$142 · 60% metered"). Estimated figures (e.g., subscription cost apportioned across sessions) never borrow metered styling; the apportionment method is one click away. This is the product's credibility spine — it is not a nice-to-have.
2. **Customer terminology — the operator's own.** The persona reads initiative, project, session, fan-out, routing, margin. Provider and model names are dimensions; raw token counts appear only inside drill-downs, subordinate to dollars. No enterprise vocabulary (seats, showback, org rollups) on any v1 surface.
3. **Every view answers "so what" (DP-3).** No cost number without its paired output (commits, deploys, sessions completed) or comparison (vs prior unit, vs tier alternative). The ledger's headline is cost-and-output per unit of work, not spend-per-month.
4. **Insights are cards with one action; evidence is tables underneath (DP-4).** Overlap, dormancy, threshold-breach, unmanaged-spend are cards, each with exactly one CTA. Drill-down grids follow user → model → charge-type → day ordering.
5. **Lead honest-positive.** Savings and coverage framing where the data supports it ("$3,400 reclaimable"), never celebratory chrome over bad news; a threshold breach is stated flat, with the action.
6. **Progressive disclosure.** L4 pages are two levels deep maximum: rollup → drill-down. No 6-level hierarchy (the v1 failure the 2026-03-23 assessment flagged).
7. **Claims match GA (DP-5).** No provider name, connector, or capability appears in UI/copy without a working data path. Unconnected providers render as "not connected," never as empty charts.

## Structural dictionary (L0–L4)

**L0 — tokens** (inherited from quantifai-lite, the salvaged brand): warm dark neutrals (`#0a0a0a` bg, `#131210` surface), gold accent `#f0c05e`/`#e8a735`; Space Grotesk (display) / Inter (body) / JetBrains Mono (numeric); `.metric-number` tabular numerals. Semantic chart palette, formalized per the assessment's P0: **gold = cost (primary), blue = usage, green = savings/reclaimable, red = overage/breach**; provider identity by ordinal neutrals, not brand colors (four vendors' brand palettes would fight the semantic layer).

**L1 — atoms:** metric number; provenance badge (`subscription_amortized`/`api_metered`/`estimated` — matches the schema enum; distinct fill, not color-only, accessibility); trend delta (▲▼ + %); threshold marker (chart rule + label); coverage chip ("N/N sessions covered"); connection-status dot.

**L2 — molecules:** metric card (hero number + delta + sparkline); insight card (icon, one-sentence finding, dollar figure, single CTA); unit-of-work row (initiative/project name, cost, provenance mix, output pair, session count); tier-split row (model tier, cost share, what ran on it).

**L3 — organisms:** unit-of-work ledger table (project/initiative rows, sortable by cost, Finout-derived drill ordering: unit → session → model → day); cost-vs-output pairing strip (the "so what" organism — cost beside commits/deploys per unit); routing-calibration panel (per-tier cost split for a fan-out, dial-anchor comparison); insight rail (max 4 cards, ranked by dollar impact); connections panel (per-source state + last-sync + error surface — `last_sync_error` is user-visible, the retired build's silent-facade failure inverted).

**L4 — pages:** `unit-of-work-ledger` (the pilot screen: practice hero total + provenance mix, ledger table, cost-vs-output strip — JTBD-1; **shipped in the first slice 2026-07-03**; the insight rail is deliberately post-slice — descoped from the first build, returns with the first real insight computation rather than as empty chrome); `routing-calibration` (JTBD-2: fan-out tier splits, dial re-anchor evidence); `practice-numbers` (JTBD-3: the positioning-bracket export — cost/output per project, deploys per week, as-of-date + methodology note); `settings/connections`. Nothing else in v1. `client-billing` (JTBD-4) is v2, gated on ADR-0003 KQ-3.

**Empty states** (assessment P0, standardized): relevant icon + what-will-appear-here explanation + the one action that fills it ("Connect Anthropic — 2 minutes"). Never a bare "No data."

## Testing baseline (day one, per METHODOLOGY)

- CI gate: `tsc --noEmit` + eslint on every push.
- Vitest for non-trivial logic only: provider adapters (normalization), allocation math (seat ÷ headcount with coverage computation), threshold evaluation, crypto round-trip. The `LESSONS-LEARNED.md` bug classes (atomic upsert, `.in()` chunking, NULL-in-UNIQUE, cron-secret inversion) each get a regression test at first touch.
- Playwright `@smoke`: org-spend-rollup renders with seeded data; provenance badges present; connections panel reflects auth state.
- Lighthouse-CI on the two L4 pages; Gitleaks mandatory (provider admin keys are the crown jewels here — appsec checklist R1/R2/R5 apply).

## Architectural invariants

1. **Boundary parsing** — provider payloads are parsed/validated at the adapter boundary (one Zod schema per provider adapter); nothing downstream touches raw provider JSON.
2. **Page metadata** — portal-contract invariant, N/A for the product app (recorded 2026-07-03 after two slices shipped without it): `window.PROTO_PAGE` belongs to Blueprint portal prototype pages; `apps/app/` is the product, not a portal prototype, and does not carry it.
3. **Single Providers interface** — all four connectors implement one `Provider` interface (fetch window → normalized rows with provenance); no per-provider special-casing outside its adapter.
4. **One-primary-CTA structural lint** — the one-primary-action rule above is enforced by a structural lint (test asserts ≤1 `data-primary-cta` per rendered page), not by review vigilance.

## Confident preview

The portal is a stakeholder review surface — one confident take per route, not a deliberation venue (per `docs/methodology/confident-preview-rule.md`). Alternatives and rejected options live in the strategy panel citations and ADRs, never as side-by-side UI variants asking the owner to pick.

## Design-system posture

Portal chrome (Pattern A) stays stock `@blueprint/ui`. Product screens use the L0 tokens above as a theme layer — custom tokens, not a custom design system; R-3/R-4 anchor depth beyond this is deliberately deferred (vendor UIs unobservable per `research/competitive/dedicated-vendors.md`; the accessible quality anchors are provider consoles the operator holds seats for, to be captured at Stage 3 if needed).
