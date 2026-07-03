// cost-dial.mjs — resolve the blueprint.yml `cost:` block (ADR-0003) into a
// per-stage { effort, modelTier, skipJustification } vector, and expose the
// methodology's PROVISIONAL anchors so the step-6 skip-justification gate can
// detect a stage resolved BELOW its anchored default without a written reason.
//
// Dependency-free ESM — matches the rest of template/tools/ (no yaml dep; the
// `cost:` block has a fixed, shallow shape we parse directly). If the block is
// absent or malformed, every stage degrades to the built-in DEFAULT — never throws.
//
// Reference: ADR-0003-cost-effort-dial.md, docs/patterns/tiered-orchestration-pattern.md.

import { readFileSync } from 'node:fs';

// ── Enums (Claude Code's effort enum, VERBATIM) ──────────────────────────────
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'inherit'];

// Rank for under-processing comparison. `inherit` is the session model — unknown
// at static resolve time, so it is deliberately unranked (null): the gate cannot
// prove a downgrade against it and must not flag one.
const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
const MODEL_RANK = { haiku: 0, sonnet: 1, opus: 2, inherit: null };

export function effortRank(effort) {
  return Object.prototype.hasOwnProperty.call(EFFORT_RANK, effort) ? EFFORT_RANK[effort] : null;
}
export function modelRank(tier) {
  return Object.prototype.hasOwnProperty.call(MODEL_RANK, tier) ? MODEL_RANK[tier] : null;
}

// ── Built-in fallback + PROVISIONAL per-stage anchors ────────────────────────
// Seeded from the tiered-orchestration ladder (Orchestrator/arbitration = opus
// high; Implementer = sonnet high; verification = opus xhigh; mechanical = sonnet
// low). NOT calibrated — re-anchor from .blueprint/telemetry.jsonl after ~10
// cycles. These are the gate's reference: a consumer resolving BELOW an anchor
// without skip_justification is the recorded-conscious-choice violation.
export const DEFAULT = { effort: 'medium', modelTier: 'inherit', skipJustification: null };

export const ANCHORS = {
  research:   { effort: 'high',   modelTier: 'opus' },
  design:     { effort: 'high',   modelTier: 'opus' },
  prototype:  { effort: 'high',   modelTier: 'sonnet' },
  fact_check: { effort: 'xhigh',  modelTier: 'opus' },
  documents:  { effort: 'medium', modelTier: 'sonnet' },
  deploy:     { effort: 'low',    modelTier: 'sonnet' },
  iterate:    { effort: 'medium', modelTier: 'sonnet' },
};

// ── Minimal parser for the `cost:` block ─────────────────────────────────────
// Shape (the only shape we emit; see template/blueprint.yml):
//   cost:
//     default:
//       effort: medium
//       model_tier: inherit
//     stages:
//       research: { effort: high, model_tier: opus }
//       deploy:   { effort: low, model_tier: sonnet, skip_justification: "mechanical" }

function stripScalarComment(s) {
  // Cut a trailing ` # comment` that is not inside quotes. Our scalar values are
  // bare words (medium, opus); the only quotes appear inside inline maps.
  const i = s.search(/\s+#/);
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

function splitTopLevelCommas(s) {
  // Split on commas that are NOT inside a quoted string. A value like
  // skip_justification: "spike-only, deferred" must survive intact.
  const parts = [];
  let buf = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ',') {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

function parseInlineMap(braced) {
  // braced: the text between { and }. Split on top-level commas (no nested braces
  // in our shape), each piece `key: value`; unwrap quotes on value.
  const out = {};
  for (const piece of splitTopLevelCommas(braced)) {
    const m = /^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/.exec(piece);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function normalizeStage(raw) {
  // raw keys use blueprint.yml's snake_case `model_tier` / `skip_justification`;
  // normalize to the resolver's camelCase contract.
  const effort = raw.effort && EFFORT_LEVELS.includes(raw.effort) ? raw.effort : undefined;
  const modelTier = raw.model_tier && MODEL_TIERS.includes(raw.model_tier) ? raw.model_tier : undefined;
  const skipJustification = raw.skip_justification != null ? String(raw.skip_justification) : null;
  return { effort, modelTier, skipJustification };
}

/**
 * Parse a blueprint.yml string into { default, stages }. Both already normalized
 * to the camelCase contract. Returns built-in DEFAULT when the block is absent.
 */
export function parseCostBlock(ymlText) {
  const lines = ymlText.split('\n');
  let i = lines.findIndex((l) => /^cost:\s*(#.*)?$/.test(l));
  // `present` lets the step-6 gate distinguish an operator who deliberately wrote
  // a cost block (and may have downgraded a stage) from a consumer on built-in
  // defaults (no conscious under-processing choice → nothing to gate).
  if (i < 0) return { present: false, default: { ...DEFAULT }, stages: {} };

  let dflt = { ...DEFAULT };
  const stages = {};
  let section = null; // 'default' | 'stages'

  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue; // blank / comment
    if (/^\S/.test(line)) break; // dedent to a new top-level key → cost block ends

    const two = /^  ([A-Za-z_]+):\s*(.*)$/.exec(line); // 2-space child of cost:
    if (two) {
      const key = two[1];
      if (key === 'default') { section = 'default'; continue; }
      if (key === 'stages') { section = 'stages'; continue; }
    }

    if (section === 'default') {
      const m = /^\s{4,}([A-Za-z_]+):\s*(.+)$/.exec(line);
      if (!m) continue;
      const norm = normalizeStage({ [m[1]]: stripScalarComment(m[2]) });
      if (norm.effort) dflt.effort = norm.effort;
      if (norm.modelTier) dflt.modelTier = norm.modelTier;
    } else if (section === 'stages') {
      const m = /^\s{4,}([A-Za-z_]+):\s*\{(.*)\}/.exec(line);
      if (!m) continue;
      stages[m[1]] = normalizeStage(parseInlineMap(m[2]));
    }
  }
  return { present: true, default: dflt, stages };
}

/** Read + parse the cost block from a target dir's blueprint.yml (never throws). */
export function readCostBlock(targetDir) {
  try {
    return parseCostBlock(readFileSync(`${targetDir}/blueprint.yml`, 'utf8'));
  } catch {
    return { present: false, default: { ...DEFAULT }, stages: {} };
  }
}

/**
 * Resolve the effective vector for a stage: stage override → default → built-in.
 * Always returns a complete { effort, modelTier, skipJustification }.
 */
export function resolveCost(costBlock, stage) {
  const d = costBlock?.default || DEFAULT;
  const s = costBlock?.stages?.[stage] || {};
  return {
    effort: s.effort || d.effort || DEFAULT.effort,
    modelTier: s.modelTier || d.modelTier || DEFAULT.modelTier,
    skipJustification: s.skipJustification ?? null,
  };
}

/**
 * Under-processing check for the step-6 gate: is `resolved` below the stage's
 * ANCHOR with no skip_justification? Returns { belowAnchor, dimensions, anchor }.
 * `inherit`/unranked tiers never count as a downgrade (cannot be proven).
 */
export function underProcessed(stage, resolved) {
  const anchor = ANCHORS[stage];
  if (!anchor) return { belowAnchor: false, dimensions: [], anchor: null };

  const dims = [];
  const er = effortRank(resolved.effort), ea = effortRank(anchor.effort);
  if (er != null && ea != null && er < ea) dims.push({ dim: 'effort', got: resolved.effort, anchor: anchor.effort });

  const mr = modelRank(resolved.modelTier), ma = modelRank(anchor.modelTier);
  if (mr != null && ma != null && mr < ma) dims.push({ dim: 'model_tier', got: resolved.modelTier, anchor: anchor.modelTier });

  const belowAnchor = dims.length > 0 && !resolved.skipJustification;
  return { belowAnchor, dimensions: dims, anchor };
}

// ── Self-test (node cost-dial.mjs --self-test) ───────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  const SAMPLE = `tier: 2
execution:
  depth: standard
cost:
  default:
    effort: medium                  # comment
    model_tier: inherit
  stages:
    research:    { effort: high,  model_tier: opus }     # arbitration-heavy
    deploy:      { effort: low,   model_tier: sonnet, skip_justification: "mechanical" }
    iterate:     { effort: medium, model_tier: sonnet }

quality:
  audit_before_share: true
`;
  const cb = parseCostBlock(SAMPLE);
  assert(cb.present === true, 'present=true when cost block exists');
  assert(cb.default.effort === 'medium' && cb.default.modelTier === 'inherit', 'default parsed');
  assert(cb.stages.research.effort === 'high' && cb.stages.research.modelTier === 'opus', 'research stage parsed');
  assert(cb.stages.deploy.skipJustification === 'mechanical', 'deploy skip_justification unquoted');

  // A justification containing a comma must survive the inline-map split.
  const commaCb = parseCostBlock('cost:\n  stages:\n    fact_check: { effort: low, model_tier: sonnet, skip_justification: "spike-only, deferred to next cycle" }\n');
  assert(commaCb.stages.fact_check.skipJustification === 'spike-only, deferred to next cycle', 'skip_justification with comma survives');
  assert(commaCb.stages.fact_check.effort === 'low' && commaCb.stages.fact_check.modelTier === 'sonnet', 'comma value did not corrupt sibling keys');
  assert(!cb.stages.quality, 'parser stopped at the cost block dedent (quality not captured)');

  const r = resolveCost(cb, 'research');
  assert(r.effort === 'high' && r.modelTier === 'opus', 'resolveCost stage override');
  const u = resolveCost(cb, 'documents'); // not named → default
  assert(u.effort === 'medium' && u.modelTier === 'inherit', 'resolveCost falls to default');

  // Under-processing: deploy resolves low/sonnet == anchor low/sonnet → not below.
  assert(underProcessed('deploy', resolveCost(cb, 'deploy')).belowAnchor === false, 'deploy at anchor, not below');
  // A stage forced below anchor with no justification → flagged.
  const forced = { effort: 'low', modelTier: 'sonnet', skipJustification: null };
  const uf = underProcessed('research', forced);
  assert(uf.belowAnchor === true && uf.dimensions.length === 2, 'research forced low/sonnet flagged on both dims');
  // Same downgrade WITH justification → not flagged.
  assert(underProcessed('research', { ...forced, skipJustification: 'spike only' }).belowAnchor === false, 'justification clears the gate');
  // inherit never counts as a model downgrade.
  assert(underProcessed('research', { effort: 'high', modelTier: 'inherit', skipJustification: null }).belowAnchor === false, 'inherit model not a downgrade');

  // Absent block → all DEFAULT, present=false (the gate's PASS signal).
  const empty = parseCostBlock('tier: 1\nquality:\n  cite_sources: true\n');
  assert(empty.present === false, 'present=false when no cost block');
  assert(empty.default.effort === 'medium' && Object.keys(empty.stages).length === 0, 'absent cost block → DEFAULT');

  console.log('cost-dial self-test: PASS (12 assertions)');
}
