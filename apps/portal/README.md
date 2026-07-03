# @blueprint/portal

The unified family portal — front door across strategy, demos, build, operate, methodology, roadmap.

## Stack

- **Astro 5** — content-first, native markdown collections, fast SSR
- **React 19** islands for interactive parts (audience switcher, future live-iframe wrappers)
- **Tailwind 3** via PostCSS, consuming `@blueprint/design-tokens/tailwind` preset
- **`@blueprint/ui`** — family component kit (Shell, NavBar, LaneCard, AudienceSwitcher, StatusBadge, plus generic Button/Badge/Alert/Card/Tabs/Modal and roadmap viz Swimlane/TaskBar/DependencyArrow)

## Develop

```bash
npm install
npm run dev --workspace=@blueprint/portal
```

Opens on `http://localhost:4321` by default.

## Build

```bash
npm run build --workspace=@blueprint/portal
```

Outputs static-first build to `dist/`. Deployable to Cloudflare Pages, Netlify, Vercel, or any static host.

## IA — five verbs + Roadmap

| Route | Verb | What it answers |
|-------|------|-----------------|
| `/` | (overview) | What is this, who is it for, pick how to enter |
| `/discover` | Discover | North star, value prop, the bet (PRD/BRD/STRATEGY excerpts) |
| `/try` | Try | Live storefront + admin demos, guided scenarios |
| `/build` | Build | API, ADRs, SDKs, component library, integration patterns |
| `/operate` | Operate | Merchant + subscriber guides, dunning, support runbooks |
| `/inspect` | Inspect | Methodology, Hive substrate, decision lineage, derived state |
| `/roadmap` | Roadmap | Ready queue, epic progress, swimlane visualization |

The audience switcher (top-right) reorders lanes by audience priority — executive / evaluator / engineering — and persists to localStorage.

## Scaffolding into a new initiative

Do not copy this directory by hand. Use the stamper:

```bash
node $BLUEPRINT_HOME/template/tools/blueprint-init/stamp.mjs \
  --name=<project-slug> \
  --display-name="<Project Display Name>" \
  --repo-url=https://github.com/<owner>/<repo> \
  --tagline="<one-line tagline>" \
  --variant=greenfield|midstream|brownfield \
  --tier=1|2 \
  --pattern=A \
  --target=<absolute path to initiative root>
```

The stamper handles project name, repo URL, tagline, package scope, `--quan-*` CSS prefix, and logo substitution. Post-stamp mechanical check fails on any unexpected residual `quantifai-next` strings.

## Substrate-specific extensions

Some surfaces in this scaffold are substrate-aware (Hive, state-derive, platform governance views) and are NOT generic Tier-1 features:

| Surface | What it does | Tier-1 default |
|---|---|---|
| `src/lib/derived.ts` + `src/components/DerivedRoadmap.tsx` | Reads `docs/audits/_state.json` (state-derive output) and Hive substrate data | Replace with hand-authored markdown roadmap if `substrate: 'none'` in `blueprint.yml` |
| `src/components/SubstrateDashboards.tsx`, `src/pages/inspect/gates.astro`, `coverage.astro`, `dependencies.astro`, `attestations.astro` | Hive-and-state-derive governance dashboards | Ship `/inspect` as a single methodology overview page linking to `docs/decisions/` (ADRs) for Tier 1 without Hive |
| Content paths in `src/lib/content.ts` (`PRD.md`, `BRD.md`, `STRATEGY.md`, etc.) | Hard-coded to the reference initiative's document filenames | Initiative may override by editing the doc-name list; future ADR to parameterize via `blueprint.yml` |

The substrate-specific paths are advanced Tier-2 features that should ideally move to an optional `@blueprint/ui-substrate-hive` add-on package — tracked in the methodology backlog.

### Known limitation — substrate build coupling

The `loadState` / `loadBoard` / `loadEpicFootprint` loaders in `src/lib/derived.ts` call `readFileSync` on substrate-output files (`docs/audits/derived/_state.json`, `docs/hive/_board.json`) without graceful-degradation. A stamped initiative that does not run state-derive or Hive will hit `ENOENT` during `astro build` on any page that calls these loaders.

**Workarounds until the substrate-tolerance refactor lands:**

1. **Delete the substrate-aware pages** from `src/pages/inspect/` if your initiative has no Hive / state-derive substrate. The portal-pattern-a-conformance-reviewer treats the `/inspect` route as "required" but the substrate sub-pages are not required by the IA contract.
2. **Populate placeholder substrate data** — write a minimal valid `_state.json` (zero capabilities) and `_board.json` (zero issues) so the pages render with empty content.
3. **Run the substrate tooling** if your initiative actually uses Hive — see `$BLUEPRINT_HOME/docs/patterns/hive-coordination-pattern.md`.

The proper fix (`loadState` returning `null` on missing-file, pages rendering "Not configured" placeholders) is tracked as future methodology work.
