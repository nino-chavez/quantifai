---
name: blueprint-prototype
description: Prototype phase of a Blueprint initiative. Three target paradigms (static portal, embedded prototype, hybrid); pick by reading blueprint.yml prototype.host + prototype.design_system. Use during Stage 2 prototyping work after Stage 1 research has identified scope and patterns.
---

# /blueprint-prototype

Prototype phase of a Blueprint initiative. Three target paradigms; pick by reading `blueprint.yml prototype.host` + `prototype.design_system`.

## the B2B client engagement selector — read this first

| `prototype.host` | `prototype.design_system` | the B2B client engagement |
|---|---|---|
| `standalone` (or unset) | `bigdesign` | **Platform-pattern SliceShell.** Slice-per-directory under `prototypes/<slice-name>/`; each slice wraps in `<SliceShell>` with `tools` / `notes` / `traces`. Harness chrome shipped per slice. Existing pattern; documented below. |
| `standalone` (or unset) | `custom` | **Standalone custom-design-system prototype.** Whole-webapp shape, not slice-per-directory. Project owns its own harness chrome (reviewer drawer, strategy panels, annotations, traceability) per `$BLUEPRINT_HOME/docs/case-studies/design-system-audit.md` D-1..D-10. No SliceShell. |
| `atelier` | `custom` | **Atelier-hosted prototype.** Project ships content + `.atelier/prototype.yaml` declaring `content_path` + `traceability_source` + `surfaces` mapping. **Harness chrome is provided by Atelier's `/prototype` route** (ADR-057). Annotations land as `contributions` with `kind: 'design'`; strategy notes via `log_decision`; traceability via `get_context(scope_files)`. Project does NOT re-implement these primitives. |

If `prototype.host` is unset, default to `standalone`. If `prototype.design_system: custom` is set without `prototype.host: atelier`, that's the second row — project owns its own harness.

## When to use
After research is complete and design tokens + principles are codified in `prototype/DESIGN.md`.

## What it does (BC-pattern SliceShell — paradigm 1 above)

The steps below apply ONLY to BC-pattern SliceShell prototypes. For standalone custom-design-system or Atelier-hosted paradigms, the slice cloning + SliceShell wrapping steps do NOT apply — see paradigm-specific notes at the end of this file.

1. **Read the contract** — Load:
   - `prototype/CONVENTIONS.md` (mandatory slice rules — SliceShell chrome, anti-patterns, file layout)
   - `prototype/DESIGN.md` (extracted tokens and principles)
   - `prototype/prototypes/_template/` (the skeleton you'll clone)

2. **Clone the template** — For each requested slice:
   ```bash
   cp -r prototype/prototypes/_template prototype/prototypes/<slice-name>
   ```

3. **Customize `prototype.config.json`** — Replace placeholder fields:
   - `name` — human-readable slice name
   - `description` — 1-2 sentences on what the slice covers
   - `brdRef` — the project's spec reference (e.g., "Epic 4 — Catalog enablement")
   - `phase` — "MVP" | "P2" | "P3"
   - `pages` — one entry per page, with `name`, `route`, optional `story` (spec shorthand) and `traces` (additional spec IDs)
   - `flows` — optional reviewer-facing suggested click-throughs

4. **Update `routes.tsx`** — Change `<Route path="_template">` to `<Route path="<slice-name>">`; add or rename child routes to match `pages[]` in the config; rename imports and the exported component.

5. **Build each page** — For every page:
   - Wrap in `<SliceShell config={sliceConfig} sliceName="<slice-name>" currentPageName="<exact name from config>" tools={tools} notes={notes}>`
   - Place real product UI (the merchant's or end user's view) inside `children`
   - Place harness controls (scenario switcher, reset, simulate-error) inside `tools`
   - Place explanatory context (where this renders in production, spec mapping) inside `notes`
   - Use only components from the platform design system and `@/components/SliceLayout` unless a new component is genuinely required
   - Apply terminology and CTA hierarchy rules from DESIGN.md
   - One primary CTA per page

6. **Replace mock data** — Edit `data/mock.ts` to match what the slice needs (typed; not `any`).

7. **Wire traceability (if the project has it)** — If `src/generated/traceability.json` is populated, ensure each page's `traces` and `story` IDs resolve. Missing IDs render as dashed chips, which signals a gap in the registry.

## Output files
- `prototype/prototypes/<slice-name>/prototype.config.json`
- `prototype/prototypes/<slice-name>/annotations.json` (empty array)
- `prototype/prototypes/<slice-name>/routes.tsx`
- `prototype/prototypes/<slice-name>/data/mock.ts`
- `prototype/prototypes/<slice-name>/pages/*.tsx`

The Studio Home page rediscovers slices automatically — do not edit `src/pages/Home.tsx` when adding a slice.

## Quality gates (must pass before declaring done)

### Scaffolding gates

- `npm run typecheck` is clean
- Every page wraps in `SliceShell` with `tools` / `notes` populated where appropriate
- Page body contains NONE of the anti-patterns from CONVENTIONS.md (no inline "Prototype controls" panels, no spec footers in body, no "in production this renders…" Messages in body, no reviewer-shortcut buttons in product UI)
- Page body looks like production UI when the harness drawer is closed
- One primary CTA per page
- Sidebar nav highlights the correct page; prev/next bar wires up correctly

### Design-system completeness gates (per `$BLUEPRINT_HOME/docs/case-studies/design-system-audit.md`)

Beyond scaffolding correctness, the prototype must answer **ten design-system decisions** (D-1..D-10) in `prototype/DESIGN.md` frontmatter AND apply them consistently in code:

- **D-1 Color** — palette + semantic scales + dark mode tokens declared (build optional)
- **D-2 Typography** — ramp tuples (size, leading, weight, tracking, family) per token; three-weight rule; tabular-numerals policy; italic policy; `.label-eyebrow` token defined and applied; optical sizing on
- **D-3 Iconography** — library decision named (Lucide React / Heroicons / Phosphor / roll-own); sizing scale; at least one icon per surface
- **D-4 Spacing/shape/elevation** — scale rationale documented; elevation strategy (flat vs layered) named
- **D-5 Motion** — durations + easings declared; at least one transition applied
- **D-6 Components** — Button, Field, Card, Tabs, Banner, Chip, Avatar primitives exist; empty/loading/error state examples demonstrated
- **D-7 A11y** — `*:focus-visible` rings; WCAG AA contrast on every token pairing; one h1 per route; aria-labels on icon buttons
- **D-8 Responsive** — sanity-checked at 375px; mobile nav decision named; touch targets ≥44px
- **D-9 Data formatting** — date/time format rules; number formatting; tabular numerals on counters/timestamps/codes
- **D-10 Content tokens** — vocabulary lock enforced; banned-word lint passes; `.label-eyebrow` used instead of ad-hoc `uppercase tracking-wider`

If `prototype.design_system: custom`, all ten are mandatory. If targeting an existing design system, inherit D-1..D-4 + D-6 from the host; D-5, D-7..D-10 are still required.

A prototype that scaffolds, typechecks, and wraps slices in SliceShell but leaves D-1..D-10 unaddressed is **incomplete** even if the IA passes review.

---

## the B2B client engagement 2 — Standalone custom-design-system prototype

Applies when `prototype.host: standalone` (or unset) AND `prototype.design_system: custom`.

The slice-per-directory `prototypes/<slice-name>/` structure does NOT apply — the prototype is a whole webapp, not slices inside a host. Routes live directly under `src/pages/`; the app shell is the project's own (`AppShell.tsx`), not `SliceShell`.

What the project still ships:

- Full D-1..D-10 design-system completeness (see audit doc)
- The project's OWN harness chrome — reviewer drawer + strategy panels + annotations + traceability. None of these are inherited from `_template/`; build them in `src/components/`.
- `audit-contrast.mjs` + `lint-design-system.mjs` in `prototype/scripts/` (shipped in the BB template; populate the tokens)

What the project does NOT ship:

- `SliceShell` wrappers
- `prototype.config.json` per slice
- the platform design system components

Worked example: `wip/atelier-dashboard-blueprint/prototype/` — 7-route React + Tailwind v4 + Fraunces, deployed to CF Pages as a self-contained stakeholder review site.

---

## the B2B client engagement 3 — Atelier-hosted prototype

Applies when `prototype.host: atelier`. The substrate provides harness chrome (per ADR-057, substrate-side); the project provides surface content.

What the project ships:

- Surface content as React components (whatever framework matches the project's stack; Atelier mounts via standardized contract)
- `.atelier/prototype.yaml` declaring:
  - `name` — prototype display name
  - `content_path` — where Atelier finds the built surfaces
  - `traceability_source` — path to `design-principles.md` or equivalent + research artifact directory
  - `surfaces` — route → strategy_notes mapping (one paragraph per surface naming the DPs it codifies)
- Per-surface annotations land as `contributions` with `kind: 'design'` + `artifact_scope` pointing at the surface; the project does NOT implement annotation storage

What Atelier provides (project does NOT re-implement):

- Reviewer drawer (scenario toggles, scale simulator, loading-state preview)
- Strategy panels (rendered from `.atelier/prototype.yaml surfaces[*].strategy_notes`)
- Annotation overlay (writes to substrate via `claim` with `kind: 'design'`)
- Traceability resolver (resolves DP-N + research/§ via `get_context(scope_files)`)
- Presence indicator (who's reviewing the current surface, from `sessions`)

The substrate-side capability is provisioned by ADR-057 + the new `/prototype/<project_id>` route in Atelier's webapp. Without that ADR accepted on `wip/atelier`, paradigm 3 is unavailable; fall back to paradigm 2.

Bootstrap reference: the Atelier dashboard north-star initiative migrated from paradigm 2 (CF Pages standalone) to paradigm 3 (Atelier-hosted) once ADR-057 shipped. See `wip/atelier-dashboard-blueprint/META-CODIFY-EVALUATION.md` § "Refinement (2026-05-11)" for the decision trail.
