# Walkthrough artifact — user #0, practice-pricing pilot

Date: 2026-07-03 · This is the `walkthrough_citation` for pilot `solo-operator-practice-pricing` (ADR-0003). Unlike the prior citation (a proxy interview for an unreachable owner), every item below is a first-party, verifiable artifact of the operator's own practice.

## The trigger incident: this session

On 2026-07-03 the operator ran, in one working session:
- A five-agent retrospective fan-out (repo evidence, timeline archaeology, methodology read, market scan) followed by a four-agent Stage 1 research fan-out — nine subagents total, mixed model tiers, orchestrated from a Fable main loop.
- An explicit cost-optimization instruction: "fan out to cheaper faster models as needed for any particular task."
- At session end, neither operator nor agent could answer: what did this session cost, what did each fan-out cost, and what did the cheaper-tier routing save versus running everything on the top tier.

The instruction to optimize cost was given and followed; whether it worked is unmeasurable with current instruments. That is the pain, experienced first-party, on the day the pilot was defined.

## Standing evidence (pre-existing artifacts, not constructed for this pilot)

1. **`~/Workspace/dev/wip/positioning-one-pager.md`** (written 2026-04-19, from session 742dad97): the "Numbers to memorize" section contains literal unfilled brackets — "Stack decisions per project: [fill in]", "Time-to-production for Rally HQ: [fill in]", "Deploys per week at current pace: [fill in]", "Users / traffic on shipped surfaces: [fill in]". These are practice-level metrics the operator wanted for job-search loops ~11 weeks ago and still cannot produce. The doc's category claim — "an architect whose execution layer is agents instead of a team of engineers" — is exactly the claim a cost-and-output-per-unit-of-work instrument substantiates.
2. **`~/Workspace/dev/tools/blueprint/docs/decisions/ADR-0003-cost-effort-dial.md`** (the methodology's own ADR): the per-stage model-tier cost dial is anchored on "Opus is ~10x the cost of Sonnet" and logs telemetry as `duration_ms` — "explicitly NOT a token-cost proxy since Claude Code doesn't expose per-turn tokens to a skill." The operator's methodology makes cost-routing decisions across all its consumer initiatives with no cost instrument; anchors are marked provisional pending "recalibration after ~10 cycles" against telemetry that cannot measure cost.
3. **Practice shape** (from workspace + prior session evidence): ~65 projects across `~/Workspace/dev` and 4 GitHub orgs; a production SaaS (Rally HQ) with real users; a published blog; subcontract work (630 Volleyball); Claude Code as primary engine with multi-agent orchestration as standard practice. The practice is cross-provider and project-plural — the two properties that make provider-native single-tool dashboards structurally insufficient for it.

## How the owner answers the question today

They don't. The observable workarounds: `/cost` per-session spot checks, provider console month-views, and — for the methodology — a duration proxy its own ADR disclaims. No per-project, per-initiative, or cost-vs-output view exists anywhere in the practice.

## Jobs derived from this walkthrough (feed persona JTBD)

1. Price a unit of work: what did this initiative/project/session cost, across subscription and API, across providers.
2. Validate routing: did the cheaper-tier fan-out save money at equal outcome — calibrate the Blueprint cost dial from data.
3. Substantiate the leverage claim: fill the positioning one-pager's brackets — cost and output per project, deploys per week, inference-spend-in-lieu-of-team.
4. (Deferred, revenue hypothesis) The same unit-of-work line item, sold to agencies as billing/margin.
