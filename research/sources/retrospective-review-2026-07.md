# QuantifAI Retrospective Product Review — 2026-07-03

Method: five parallel evidence agents (platform repo, lite+sync repos, cross-repo timeline + landing audit, Blueprint methodology, live market scan), synthesized in one session. Every code claim below cites a file or commit; market claims cite URLs.

## Verdict

**Retire the current builds as products. The concept earns exactly one more investment: a Blueprint Stage 1 research pass with a locked pilot profile, run as a new initiative — and it dies there unless a named buyer signs the walkthrough. Salvage the schema, the shipper, and the design tokens regardless.**

Not "revive as-is" — the code documents features that don't exist (see Scope honesty) and the market has moved under it. Not an unconditional "rebuild" — the thing that killed QuantifAI was never model capability or code quality; it was that no buyer was ever named and no user other than the builder ever touched it. Rebuilding the software without fixing that reproduces the failure at higher quality. The Blueprint pilot-profile lock is the mechanism that forces the fix, which is why the rebuild is gated on it.

The concrete next step, if pursued: `npx @nino-chavez-labs/blueprint-cli init --pattern=A --name=quantifai-next`, lock the pilot profile with a real enterprise stakeholder as `walkthrough_citation`, run Stage 1 with the cost dial set to fan research sweeps out to cheaper models. Budget: days, not weeks. If no stakeholder materializes, the answer was "retire" and it cost one research stage to learn it.

---

## Part 1 — Product review, as built

### What actually exists (correcting the record)

The family is five repos built in a six-day sprint (2026-03-19 → 03-27), all AI-driven (commits co-authored "Claude Opus 4.6 (1M context)"):

- **quantifai-lite** came *first* (Mar 19–20, 40 commits, two days). Free solo-dev tool, GitHub OAuth, its own Supabase, 10 pages + 13 API endpoints. It has working BYOK provider polling (Anthropic Admin API, OpenAI, OpenRouter — `src/lib/providers/`), the knowledge-patterns feature (TS port), and a public Developer Index. Zero test files; README is unedited scaffold boilerplate.
- **quantifai-platform v2** (Mar 24, ~14 hours, 32 commits + 3 on remote) is a rewrite of a FastAPI v1 (`ai-ops-analytics`) that the 2026-03-23 design assessment had graded C+ the day before. v2 is 2,589 lines, 8 tables, 5 app route groups. It ported crypto and design tokens *from* Lite (`8e94b1c`). The 46-route over-scope belongs to dead v1, as does Phase 18 (knowledge patterns, built 2026-03-19, never validated, not carried into v2).
- **quantifai-sync** is the strongest engineering artifact: Go daemon, 20 test files passing, cross-platform service install, real v0.1.0 release with 10 signed assets plus a homebrew tap. Caveat: the tap's formula URLs point at the pre-transfer `quantifai-app/sync` path and work only via GitHub's redirect.
- **quantifai-landing** (May 23, two commits, then silence) and the **homebrew tap** round it out.

Errata for future sessions: the platform's canonical remote is `QuantifAi-App/platform` (the `nino-chavez/quantifai-platform` name 404s), and the local clone is 3 commits behind — true last main commit 2026-03-26, true last activity 2026-03-27 on an unmerged branch.

### Problem/buyer fit — the central failure

The buyer was never chosen. The landing page's request-access form asks the *visitor* "What FinOps question are you trying to answer?" (`archive/quantifai-landing/index.html`) — the product outsources its own positioning question to the prospect. The market has three distinct buyers for this category — IT/procurement (Zylo, Productiv, Torii), finance/FinOps (Finout, CloudZero, Vantage), platform-eng leadership (Faros, Jellyfish, DX) — and no source shows a single unified budget owner ([getdx.com/blog/ai-coding-assistant-pricing](https://getdx.com/blog/ai-coding-assistant-pricing)). QuantifAI's surfaces (dashboard, spend, trends) serve the builder's own telemetry curiosity well and any one of those three buyers only partially.

The built thing does serve *someone* end-to-end: the working chain is Go shipper → `POST /api/v1/ingest` → `upsert_session()` → dashboard/spend/trends with real data and no mocks (`src/routes/api/v1/ingest/+server.ts`, zero hits for mock/demo/hardcoded data in `src/`). But that someone is a solo Claude Code user — Lite's audience — wearing the Platform's enterprise costume.

### The Lite/Platform split

Wrong call, in hindsight, and the evidence is that the two products converged by hand-copying: crypto ported from Lite (`8e94b1c`), design tokens ported per Lite's own `LESSONS-LEARNED.md`, pattern detector ported from v1's Python, no shared package, no shared component files (lite-reader confirmed no filename overlap). Two Supabase projects, two auth models, two ingest key formats (`ql_` vs platform `api_keys`) — five repos of maintenance for a combined user count of one. The split also fragmented the story: Lite's real differentiator (Developer Index — opt-in public benchmarks) and Platform's real differentiator (org governance) never met in one product.

### Scope honesty

v2 is more honest than v1 but still writes checks the code doesn't cash:

- **Multi-provider is a facade.** Six providers in the schema CHECK constraint and a credential-storage UI, but the only data path hardcodes `provider: 'anthropic'` at ingest (`src/routes/api/v1/ingest/+server.ts:126`). `provider_connections.last_synced_at` exists and is displayed but nothing ever writes it — no polling code exists despite README claiming it.
- **Dual auth is a ghost.** Okta OIDC was built and deleted the same day (`5682684` → `6857445`); README, CLAUDE.md, and a same-day Okta integration guide still document it as a live switchable feature. A dead `AuthProvider` type union is all that remains (`src/lib/auth/index.ts:27`).
- **The role hierarchy is decorative.** Five roles defined; only `admin` is ever checked (`api/v1/providers/+server.ts:13,28,57`).
- **Seats is a placeholder** — 21 static lines promising "Phase 5," which appears nowhere in the git log (`src/routes/(app)/seats/+page.svelte:9-20`).
- **The landing over-claims.** Copilot and Cursor are named on quantifai.app; neither has any integration in any repo. "Go shipper" sat on the landing's tech pills two months after the last engineering act was an (unmerged) branch removing the shipper.

Genuinely needed for an internal enterprise deployment: the ingest chain, org/invite model, encrypted credentials, cron aggregation. Speculative: everything above, plus multi-tenant readiness (one seeded org, `20260324000002_seed.sql`).

### Why it stalled

Energy reallocation mid-pivot, not market rejection — because the market was never asked. The last commit anywhere (2026-03-27) is the unmerged `remove-shipper-references` branch: an architecture reversal, started three days after hardening that same shipper, abandoned mid-branch. The same week, commit volume surged elsewhere (rally-hq 45, bealls-aisles 64, ask-bc 25, document-resonance 36 in the following three weeks). The landing page — the first artifact that could have produced external contact — was written **two months after** the code stopped, got two commits in one day, and went quiet. No customer conversations, rejected pitches, or competitive-loss notes exist anywhere. The build ran entirely ahead of the distribution plan; the distribution plan never ran at all. The operator's own positioning doc already files QuantifAI as third-tier portfolio evidence ("if the loop calls for it," `wip/positioning-one-pager.md:34`).

### Market now (2026-07)

The March gap has substantially eroded, on both flanks:

- **Providers closed the single-vendor gap themselves.** Anthropic now ships per-user/per-group cost dashboards, spend alerts, and a Claude Code Analytics API with per-developer cost ([claude.com/blog](https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend), [platform.claude.com/docs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)). Cursor shipped admin spend limits, per-team budgets, and org-wide usage views (May–Jun 2026, [cursor.com/blog/organizations](https://cursor.com/blog/organizations)). Copilot's Metrics API went GA Feb 27 ([github.blog/changelog](https://github.blog/changelog)). None of this existed when QuantifAI was built.
- **Funded direct competitors arrived.** Larridin ($17M seed, a16z) launched Token Spend & Insights in June ([morningstar.com](https://www.morningstar.com/news/business-wire/20260623812852)); Torii shipped a dedicated AI Management Platform in May and made Leader in Gartner's July 2026 SaaS Management MQ ([hpcwire.com](https://hpcwire.com/aiwire/2026/05/13)); Olakai (AI Fund) covers cross-vendor governance. Zylo and Productiv now explicitly cover AI seats.
- **What's still unclaimed:** true cross-provider, per-developer seat-plus-token unification ("for developer X across Copilot + Cursor + Claude Code, what did they cost, use, and produce this month") — no player demonstrates it end-to-end, and FOCUS v1.4 still lacks a common AI billing schema ([finops.org/topic/focus](https://finops.org/topic/focus)), so the integration moat is real. The coding-assistant-specific niche is thinner than general "enterprise AI spend."

The honest read: the remaining gap is real but is now a funded-startup race, not solo whitespace. The demand signal is also real — 18% of enterprise AI spend unattributed (Larridin, vendor-sourced), 78% of IT leaders reporting unexpected AI charges ([helpnetsecurity.com](https://helpnetsecurity.com/2026/05/01)), $200–600/engineer/month with agentic tails past $2,000 ([getdx.com](https://getdx.com/blog/ai-coding-assistant-pricing)) — which is precisely why the funded players showed up. A solo build wins here only as an internal tool with a captive deployment (the operator's employer) or as portfolio evidence, not as a venture race entry.

## Part 2 — Counterfactual A: built with Fable-class models

The Opus 4.6-era fingerprints are legible in the git history:

- **Trial-and-error against live systems instead of verified design:** five consecutive auth-flow commits in one hour ending in wholesale import of rally-hq's auth ("matches rally-hq's auth architecture exactly," `6857445`); an OTP digit-count flip-flop (`7de8f52`→`621c1b4`); a four-commit ingest-endpoint chase ending in the discovery that all failures were duplicate keys (`45d3fc5`→`757d1d6`); a self-inflicted `DROP SCHEMA public CASCADE` outage (`4a6dee3`). A Fable-class build does most of this reasoning before the first deploy and reads current vendor docs without three key-format-mismatch commits (`05494be`, `e2a3f3f`, `1fb6146`).
- **Duplication a stronger model would have abstracted:** the provider/model/day aggregation logic is written near-identically three times (`spend/+page.server.ts`, `trends/+page.server.ts`, `cron/aggregate/+server.ts`); the per-route try/catch fallback pattern is repeated verbatim across every loader instead of being one helper.
- **The v1→v2 rewrite itself is a model-era artifact.** An over-scoped 46-route FastAPI v1 got built, graded C+ by a design assessment, and scrapped the next day. A Fable build with a plan pass likely produces something v2-shaped the first time — the whole v1 (and Phase 18, which died with it) was a capability-cost paid once and discarded.
- **The Lite/Platform split was partly a context-boundary artifact.** Two repos, two two-day builds, hand-ported shared code. With current session coherence and worktree/fan-out orchestration, one product with a free tier and a gated enterprise layer is a comparable-effort build — Lite's separate existence stops being forced.

What was *not* capability-limited, then or now: Copilot and Cursor ingestion (blocked on API access, not model skill — Copilot's metrics API didn't GA until Feb 2026), and Phase 18's validation (blocked on real production data, which requires users).

**The honest delta:** Fable buys the same product faster, with fewer self-inflicted wounds, probably as one product instead of two, and with the abstraction debt not taken. It does not buy a buyer, a distribution plan, or claim discipline — the three things that actually killed this. The failure was upstream of the model. "Faster" is the correct, boring answer for the build; "unchanged" is the correct answer for the outcome, unless the process changes too. That is what Part 3 is for.

## Part 3 — Counterfactual B: built with Blueprint

Blueprint's gates map onto QuantifAI's observed failures with almost embarrassing precision:

- **The pilot-profile lock (pre-Stage 1)** requires a declared buyer (`monetization_side`), a real `walkthrough_citation` artifact, and explicit competitors in/out of scope, and mechanically blocks research until locked (`template/blueprint.yml:26-52`). QuantifAI's central failure — buyer never chosen — is the exact thing this gate exists to prevent.
- **Stage 1 research would NOT have killed it in March 2026** — and that matters for the gate's credibility. At build time, Copilot's API was in preview, Cursor had no spend controls, Anthropic had no per-user cost console, and Larridin/Torii's products didn't exist. Honest research would have found genuine whitespace *and* forced the three-buyer fragmentation into the open, most plausibly reshaping the initiative into "internal enterprise deployment with a named stakeholder first, commercial later." The sibling-project scan would also have surfaced rally-hq's auth as the canonical pattern on day one instead of commit 20.
- **Stage 3 prototype** demands a stakeholder-clickable slice with a strategy panel. The technical slice *existed* (shipper→dashboard worked). Blueprint's addition is not the demo — it's the obligation to put it in front of the declared buyer before building more. Nothing in the six-day sprint ever faced a viewer.
- **Stage 4 fact-check** would have directly caught every documented-but-unbuilt claim: README's phantom provider polling, the post-deletion Okta docs, and — had it run before the landing — the Copilot/Cursor claims on quantifai.app. The subs-initiative case study (charge pipeline marked COMPLIANT that threw on the real payment path; ~15 recovery PRs) is the recorded price of skipping this stage (`docs/case-studies/case-study-subs-skipped-stages-2-4.md`).
- **The drag, honestly:** Stage 0 legibility and the three-layer page contract are ceremony for a solo internal tool; the four-document Stage 5 package is more than an internal pilot needs (the methodology itself only mandates the Strategy doc); DESIGN.md and doc-quality audits would have added a day-plus to a six-day sprint. Blueprint's own record admits the weight — the 738-line rally-hq onboarding vs 48-line subs finding is why the cost dial and `execution.depth: lean` exist (ADR-0003). Run at `lean`, the true overhead on QuantifAI is roughly: pilot-profile lock (hours), research with sibling scan (a day, parallelizable), fact-check (hours). Against a six-day build that produced zero users, that trade needs no defense.

## Part 4 — The rebuild shape, if the gate passes

Run it as a new Blueprint initiative on the *concept*, not a revival of the repos:

- **Bootstrap:** `blueprint-cli init --pattern=A` (Pattern A is the one that works out of the box; Pattern B's initial stamp is unimplemented per the photography consumer's amendment log). Greenfield variant, `execution.depth: lean`, tier 1.
- **Cost dial / model fan-out** (`blueprint.yml cost:` block, per-stage — this is supported machinery, not improvisation): research and design at high effort on the top tier; mechanical research sweeps (competitor-doc reads, API-capability inventories) fanned out to Haiku/Sonnet subagents; prototype at Sonnet high; fact-check at xhigh — the false-green guard; deploy at Sonnet low with skip-justification. The tiered-orchestration pattern (Opus orchestrator, Sonnet implementers in parallel worktrees, mandatory `parallel-dispatch-check` before waves) covers the "fan out to cheaper faster models" requirement directly.
- **Kill-gate:** the pilot profile requires a named enterprise stakeholder (or equivalent real buyer) whose walkthrough is the citation. No stakeholder → the initiative ends at Stage 1 as a documented "retire," at the cost of days.
- **One product, not two.** If it proceeds: single codebase, provider-API polling as the primary ingestion (the direction the abandoned `remove-shipper-references` pivot was already pointing — and the provider APIs have since matured to meet it: Anthropic's usage/cost API is explicitly designed to feed third-party trackers), shipper retained only as the individual-developer enrichment path. First shippable slice: one org, Claude Code + Copilot actual data paths, per-developer seat-plus-token view — the specific thing the market scan says nobody demonstrably has.

### Salvage list (regardless of the gate's outcome)

- **quantifai-sync** — production-shaped Go daemon, 20 passing test packages, cross-platform release + tap. Reusable for any local-telemetry product. Fix the tap's pre-transfer URLs if it's kept public.
- **The schema core** — session/message two-level telemetry, `intent_tag` on every record, `upsert_session()` atomic accumulation, org/invite-only governance (`supabase/migrations/20260324000001_functions.sql`; concept extraction at `wip/practice/framework/extractions/ai-ops-analytics.md` already identifies these as the transferable layer).
- **Lite's provider pollers** (`src/lib/providers/{anthropic,openai,openrouter}.ts`) — the only working multi-provider code in the family.
- **Design tokens** (warm dark neutrals + gold, Space Grotesk/Inter/JetBrains Mono) — already ported once between products; they're the brand.
- **The 2026-03-23 design assessment's P0 list** (command palette, semantic chart palette, empty-state pattern) — none of it was ever applied; it's a ready-made Stage 2 input.

### What to retire now

Archive `quantifai-lite` and move `quantifai-platform` local checkout out of active `wip/` once salvage is extracted; take quantifai.app's landing down or replace it with a single honest paragraph — its current claims (Copilot, Cursor, "edge-native") fail the fact-check gate this document just ran. Reconcile or delete the stale README/CLAUDE.md Okta and polling claims in the platform repo so the record stops lying to future sessions.
