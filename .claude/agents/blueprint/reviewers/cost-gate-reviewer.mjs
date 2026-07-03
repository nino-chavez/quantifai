/**
 * cost-gate-reviewer.mjs — executable pair for the paired .md spec. The step-6
 * skip-justification gate (ADR-0003). Implements the ADR-0002 reviewer contract
 * so the cost gate runs in CI / CLI / any node, outside Claude Code:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (charter risk #3 — under-processing must be a recorded conscious
 * choice, never a silent default):
 *   - No cost: block in blueprint.yml  -> PASS (consumer is on built-in defaults;
 *     no deliberate config to gate; the dial stays advisory).
 *   - cost: block present, a stage resolves BELOW its anchor (lower effort and/or
 *     a cheaper model_tier) with NO skip_justification  -> BLOCK.
 *   - Below anchor WITH a skip_justification  -> WARN (the choice is recorded and
 *     visible, but does not block).
 *
 * Reuses tools/lib/cost-dial.mjs (resolveCost / underProcessed / ANCHORS) — the
 * same resolver `blueprint cost` formats. Dependency-free node ESM.
 */
import {
  readCostBlock,
  resolveCost,
  underProcessed,
  ANCHORS,
} from '../../../../tools/lib/cost-dial.mjs';

const NAME = 'cost-gate-reviewer';

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

export default async function review({ targetDir }) {
  const startedAt = Date.now();
  const findings = [];
  const cost = readCostBlock(targetDir);

  // No deliberate config → nothing to gate (advisory-only path). Keeps a
  // cost:-less consumer building, per the wave-35 backward-compat guarantee.
  if (!cost.present) {
    return result('PASS', [], 'no cost: block — built-in defaults (advisory only)', startedAt);
  }

  let blocked = 0;
  let warned = 0;
  for (const stage of Object.keys(ANCHORS)) {
    const resolved = resolveCost(cost, stage);
    const up = underProcessed(stage, resolved);
    if (up.dimensions.length === 0) continue; // at or above anchor on every dim

    const dims = up.dimensions.map((d) => `${d.dim} ${d.got} < anchor ${d.anchor}`).join('; ');
    const got = `effort=${resolved.effort}, model_tier=${resolved.modelTier}`;

    if (up.belowAnchor) {
      blocked += 1;
      findings.push({
        severity: 'BLOCK',
        location: `blueprint.yml cost.stages.${stage}`,
        message: `Stage '${stage}' resolves below its anchor (${dims}) with ${got}, and no skip_justification is set. Under-processing must be a recorded conscious choice.`,
        remediation:
          `Either raise the stage to its anchor (effort: ${up.anchor.effort}, model_tier: ${up.anchor.modelTier}), ` +
          `or add a skip_justification explaining why this stage runs cheaper — e.g. ` +
          `\`${stage}: { effort: ${resolved.effort}, model_tier: ${resolved.modelTier}, skip_justification: "<reason>" }\`.`,
        reference: 'ADR-0003-cost-effort-dial.md (skip-justification gate); docs/patterns/tiered-orchestration-pattern.md',
      });
    } else {
      // Below anchor but justified — surface it so the conscious choice is visible
      // in the review record without blocking.
      warned += 1;
      findings.push({
        severity: 'WARN',
        location: `blueprint.yml cost.stages.${stage}`,
        message: `Stage '${stage}' runs below anchor (${dims}) with ${got} — justified: "${resolved.skipJustification}".`,
        remediation: 'No action required. Recheck the justification still holds when telemetry recalibrates the anchors.',
        reference: 'ADR-0003-cost-effort-dial.md',
      });
    }
  }

  const status = blocked ? 'BLOCKED' : warned ? 'WARN' : 'PASS';
  const summary = blocked
    ? `${blocked} stage(s) below anchor, unjustified`
    : warned
    ? `${warned} stage(s) below anchor, justified`
    : 'all stages at or above anchor';
  return result(status, findings, summary, startedAt);
}
