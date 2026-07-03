---
name: blueprint-deploy
description: Deployment phase of a Blueprint initiative. Packages prototype + docs as a Vercel site. Use when ready to ship a Blueprint prototype/portal externally for stakeholder review.
---

# /blueprint-deploy

Deployment phase of a Blueprint initiative. Packages prototype + docs as a Vercel site.

## When to use
After prototype and docs are built and validated.

## Precondition: validation report must exist

Before deploying, check for a current validation report:

```bash
ls validation/$(date +%Y-%m-%d)-validate.md 2>/dev/null \
  || ls validation/$(ls validation/ 2>/dev/null | tail -1) 2>/dev/null
```

If no validation report exists (or the most recent one is older than the latest
commit to the prototype/docs), **prompt the user**:

> No current validation report found. Run `/blueprint-validate` before deploying,
> or pass `--skip-validation` to override if the skip is intentional (e.g., a
> trivial copy-only iteration that doesn't change claims).
>
> Soft enforcement — the skip flag is available, but the implicit-skip path is
> closed. This prevents shipping a deliverable where fact-check + copy audit +
> source-validation never ran on the current state.

Rationale: the `/blueprint-validate` skill is comprehensive (6-phase diagnosis
loop) but optional under prior behavior. Making it a soft-gate precondition for
deploy gives it teeth without rigid policy enforcement. See
`docs/case-studies/case-study-subs-skipped-stages-2-4.md` for the failure mode
this guards against (a project that skipped Stage 2 + Stage 4 and accumulated
fixture-mode + COMPLIANT-but-stubbed debt as a result).

## What it does

1. **Copy deliverables to prototype** — Move HTML doc files to `prototype/docs-*.html`
2. **Update landing page** — Ensure `prototype/index.html` links to all docs and prototype flows
3. **Deploy to Vercel** — `cd prototype && vercel --prod`
4. **Verify** — Open the deployed URL and check:
   - All doc links work
   - All prototype pages load
   - Strategy panels open on each page
   - Current-state panels show correct screenshots
   - Footer navigation works across all pages
   - Chat widget connects (if enabled)

## Output
- Deployed URL (e.g., `my-initiative.vercel.app`)
- This is the primary deliverable — share this one link with all stakeholders
