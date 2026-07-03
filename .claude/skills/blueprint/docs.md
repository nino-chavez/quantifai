---
name: blueprint-docs
description: Document generation phase of a Blueprint initiative. Produces strategic documents from research findings and prototype decisions. Use during Stage 3 documentation work after research and prototype phases have produced source material.
---

# /blueprint-docs

Document generation phase of a Blueprint initiative. Produces strategic documents from research findings and prototype decisions.

## When to use
After research and prototype are complete (or in parallel with prototyping).

## What it does

1. **Read blueprint.yml** — Load document definitions from `documents:` section. Each document has a type, title, and audience.

2. **Generate documents by type:**

   **Strategy doc** (internal-strategy voice):
   - Lead with the automation/self-service opportunity (headline numbers)
   - State methodology for any data claims
   - Show priorities stacking to total coverage (not overlapping)
   - Include: sequencing argument, competitive context, risk register with owners, phased roadmap, success metrics with benchmarks, open questions with owners and deadlines
   - Reference technical feasibility and research docs, don't duplicate them

   **Feasibility doc** (solution-architecture voice):
   - Map each proposed capability to existing code
   - For each: does the data exist? Is there an integration? What's the effort?
   - Split into "ships independently" vs "requires cross-team alignment"
   - Include open questions with exact code references
   - Non-prescriptive language — these are questions for the engineering team, not decisions

   **Research doc** (internal-strategy voice):
   - Organize by pattern category (not by source)
   - For each pattern: what industry does it, what we adopted, what we rejected, why
   - Inline citations for every factual claim
   - Source URLs in a Sources section at the bottom

   **Integration plan** (solution-architecture voice):
   - Architecture diagram (text-based)
   - Component-by-component implementation approach
   - Tool/data-source mapping with code examples
   - Phased rollout with scope per phase
   - Cost estimates
   - Open questions for the engineering team

   **Validation script** (always generated when the package contains demand claims):
   - Canonical shape + question rules: `$BLUEPRINT_HOME/template/docs/methodology/mom-test-validation-pattern.md`
   - Extract the riskiest demand assumptions from the strategy/prescription docs; tag each with its evidence class (repo-grounded / stakeholder-given / agent-hypothesis)
   - The three scary questions (most likely to kill the prescription) listed first
   - Per-assumption conversation plan: past-specific, their-life-not-our-idea, non-leading questions, each with the disconfirming answer spelled out
   - Commitment asks (time / reputation / money) as the close
   - The reason this doc exists: generated demand claims are hypotheses wearing evidence's clothes — the script is the explicit bridge from generated research to real validation, and `/blueprint-triage` weighs the returning feedback by commitment

3. **Run quality audit** — Before generating final output, validate each document:
   - "So what?" in the first sentence of every section
   - Tables show conclusions, not require mental math
   - No logic gaps between sections
   - Context in scannable format, not dense paragraphs
   - No redundancy across documents (use cross-references)

4. **Generate deliverables** — Convert markdown to HTML + Word:
   ```bash
   node docs/scripts/md-to-docs.mjs docs/content/[doc].md --out docs/deliverables/
   ```

5. **Copy to prototype** — Place HTML deliverables in `prototype/docs-*.html` and link from the landing page.

## Output files
- `docs/content/*.md` — markdown source files
- `docs/deliverables/*.html` — HTML versions
- `docs/deliverables/*.docx` — Word versions
- `prototype/docs-*.html` — copies for the deployed site

## Forge Signal integration

If `signal_forge.enabled` is true in blueprint.yml:
- Read voice guides from `{signal_forge.path}/docs/voice/` for authoritative voice definitions
- Read quality audit from `{signal_forge.path}/docs/voice/document-quality-audit.md`
- For thought-leadership or executive-advisory voice, consider using forge-signal's generate command:
  ```bash
  cd {signal_forge.path}
  npx tsx src/cli/index.ts generate pov -i {input.md} -f html,word -p anthropic
  ```
- For internal-strategy voice (the default), use the built-in doc-writer agent — forge-signal's ghost-writer pipeline applies blog voice which is wrong for internal docs

If forge-signal is not available, the doc-writer agent applies the same voice rules independently. The quality audit checks are built into the agent definition.

## Quality checks
- Every section passes the four-check audit
- No document duplicates content from another (use cross-references)
- Reading order is stated at the top of the strategy doc
- Technical details (code references, model names) only in feasibility/integration docs, not strategy
- Citations on every factual claim in the research doc
- Demand claims carry an evidence class; load-bearing agent-hypothesis claims appear in the validation script's assumptions table (a package may ship all-hypothesis — the check is that the script NAMES them, not that they are validated)
- Validation-script questions pass all three Mom Test rules (their life / past specifics / non-leading); no "would you…" phrasing anywhere in the script
