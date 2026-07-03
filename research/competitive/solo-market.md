# Solo-market competitive landscape — July 2026

Date: 2026-07-03 · Stage 1 leg for pilot `solo-operator-practice-pricing` (ADR-0003). Competitors of record for this pilot; the enterprise vendor analysis (`dedicated-vendors.md`) is historical context.

## KQ-1 verdict: the grain is NOT already served — initiative continues, with a build-posture correction

**Cost tracking breadth is commoditized and free.** ccusage ([github.com/ryoppippi/ccusage](https://github.com/ryoppippi/ccusage), 16.8k stars, v20.0.14 Jun 2026, actively maintained) reads local logs for ~10 tools (Claude Code, Codex, Copilot CLI, Gemini CLI, OpenCode, Amp, more) with daily/session/project grouping. openusage ([github.com/janekbaraniewski/openusage](https://github.com/janekbaraniewski/openusage), 114 stars but active) covers 34 providers with hybrid local-file + BYOK polling into local SQLite. **Nobody pairs cost with output.** Every tracker found — ccusage, openusage, Claude Usage Tracker, claude-usage, Claude-Code-Usage-Monitor — stops at tokens-and-dollars. Provider-native personal dashboards (Claude `/stats` + Settings>Usage, Cursor dashboard, Copilot premium-request analytics) are single-provider by construction and output-blind. The unit-of-work + output grain is open.

**Build-posture correction this forces:** do not rebuild ingestion breadth — that's competing with a 16.8k-star free incumbent on its own turf. The differentiation is entirely in the pairing layer (session/project cost ↔ commits/deploys/initiatives) and the practice-numbers export. Stage 3 should evaluate ccusage/openusage as the ingestion substrate (or at minimum match their parsers) rather than promoting quantifai-sync's own readers as the moat. The shipper's residual unique value is daemonized continuous collection + git-hook events, not parsing.

## The adjacent tool worth studying: Exceeds Ink

[blog.exceeds.ai](https://blog.exceeds.ai) — Rust git-hook binary writing Git Notes (`refs/notes/exceeds-ink`) at commit time: tool/model/session/token-cost per line, using native per-tool hooks (Claude Code, Cursor, Codex, Copilot, Windsurf) rather than code-pattern heuristics (vendor claims heuristics cap ~20–25% accuracy). This is the closest existing mechanism to cost↔commit pairing — positioned for AI-contribution audit/compliance at team level, not solo practice pricing or billing. **Adopt the mechanism as a build reference** (git-notes attribution is portable across forks/mirrors and survives history operations); the product positioning remains ours.

## Client-billing angle

Real, articulated, unserved: freelancer/agency forum threads discuss AI spend vs hourly-rate ROI ($638/6-weeks anecdotes), but no tool operationalizes "bill the client for this project's AI cost" — generic AI invoice generators have no cost-pass-through. Pain exists in words, market doesn't exist in tools. Consistent with ADR-0003's sequencing: revenue hypothesis, gated on KQ-3, not the pilot.

## Willingness-to-pay read

The personal cost-tracker category norm is **$0** (free CLI/OSS by individual maintainers) — a standalone paid tracker is a weak play. The paid wedge, if KQ-3 fires, is the output-pairing + billing layer for freelancers/small agencies, priced against micro-SaaS invoicing/time-tracking comparables (~$19–49/mo), not against free trackers. Helicone is in maintenance mode post-Mintlify (Mar 2026) and Langfuse serves app-API instrumentation — neither covers coding-assistant subscriptions; not competitors.

## Unverified items

OpenAI's personal usage dashboard detail was not directly verified this pass (flag for Stage 4 if it becomes load-bearing). Exceeds Ink pricing not published.
