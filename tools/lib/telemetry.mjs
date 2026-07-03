// telemetry.mjs — append-only per-stage telemetry (ADR-0003) at
// <target>/.blueprint/telemetry.jsonl, plus the aggregator the `blueprint cost`
// sweep formats. Dependency-free ESM; never throws on a missing/garbled file.
//
// One JSONL record per completed stage run:
//   { ts, stage, effort, model_tier, duration_ms, reviewer }
//   - duration_ms: a tier-weighted TIME PROXY, not dollars. Claude Code does not
//     expose per-turn tokens to a skill, so cost is approximated by wall time; do
//     not read it as spend. (ADR-0003.)
//   - reviewer: 'pass' | 'fail' | null  (did the stage's gate pass on this run)
//
// Anchors emerge from this file after ~10 cycles — they are NEVER shipped as
// defaults. See docs/patterns/tiered-orchestration-pattern.md § calibration discipline.

import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const TELEMETRY_REL = '.blueprint/telemetry.jsonl';

function telemetryPath(targetDir) {
  return join(targetDir, TELEMETRY_REL);
}

/**
 * Append one stage record. `ts` is stamped (ISO) if the caller omits it. Returns
 * the written record. Best-effort: swallows write errors (telemetry must never
 * break a stage run) and returns null on failure.
 */
export function appendTelemetry(targetDir, record, now) {
  try {
    const ts = record.ts || (now ? now : new Date().toISOString());
    const full = {
      ts,
      stage: record.stage ?? null,
      effort: record.effort ?? null,
      model_tier: record.model_tier ?? null,
      duration_ms: typeof record.duration_ms === 'number' ? record.duration_ms : null,
      reviewer: record.reviewer ?? null,
    };
    const p = telemetryPath(targetDir);
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(full) + '\n');
    return full;
  } catch {
    return null;
  }
}

/** Read + parse all records (skips blank/garbled lines). [] if the file is absent. */
export function readTelemetry(targetDir) {
  let text;
  try {
    text = readFileSync(telemetryPath(targetDir), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip a torn line */ }
  }
  return out;
}

export function median(nums) {
  const xs = nums.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/**
 * Aggregate records per stage. Returns:
 *   { stages: { <stage>: { count, medianDurationMs, passRate, byTier } }, total }
 * passRate is over records whose reviewer is non-null (pass|fail); null reviewer
 * records are excluded from the rate (they had no gate). byTier groups model_tier.
 */
export function summarizeTelemetry(records) {
  const stages = {};
  for (const r of records) {
    const stage = r.stage || '(unknown)';
    const s = (stages[stage] ||= { count: 0, durations: [], gated: 0, passed: 0, byTier: {} });
    s.count += 1;
    if (typeof r.duration_ms === 'number') s.durations.push(r.duration_ms);
    if (r.reviewer === 'pass' || r.reviewer === 'fail') {
      s.gated += 1;
      if (r.reviewer === 'pass') s.passed += 1;
    }
    const tier = r.model_tier || '(none)';
    const t = (s.byTier[tier] ||= { count: 0, durations: [] });
    t.count += 1;
    if (typeof r.duration_ms === 'number') t.durations.push(r.duration_ms);
  }

  const outStages = {};
  for (const [stage, s] of Object.entries(stages)) {
    const byTier = {};
    for (const [tier, t] of Object.entries(s.byTier)) {
      byTier[tier] = { count: t.count, medianDurationMs: median(t.durations) };
    }
    outStages[stage] = {
      count: s.count,
      medianDurationMs: median(s.durations),
      passRate: s.gated ? s.passed / s.gated : null,
      byTier,
    };
  }
  return { stages: outStages, total: records.length };
}

// ── Self-test (node telemetry.mjs --self-test) ───────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };

  assert(median([]) === null, 'median([]) is null');
  assert(median([5]) === 5, 'median single');
  assert(median([1, 3]) === 2, 'median even rounds');
  assert(median([3, 1, 2]) === 2, 'median sorts');

  const recs = [
    { stage: 'research', model_tier: 'opus', duration_ms: 1000, reviewer: 'pass' },
    { stage: 'research', model_tier: 'opus', duration_ms: 3000, reviewer: 'fail' },
    { stage: 'research', model_tier: 'sonnet', duration_ms: 500, reviewer: null },
    { stage: 'deploy', model_tier: 'sonnet', duration_ms: 200, reviewer: 'pass' },
  ];
  const sum = summarizeTelemetry(recs);
  assert(sum.total === 4, 'total counted');
  assert(sum.stages.research.count === 3, 'research count');
  assert(sum.stages.research.medianDurationMs === 1000, 'research median (1000) over [500,1000,3000]');
  assert(sum.stages.research.passRate === 0.5, 'research passRate 1/2 gated (null excluded)');
  assert(sum.stages.research.byTier.opus.count === 2 && sum.stages.research.byTier.sonnet.count === 1, 'research byTier split');
  assert(sum.stages.deploy.passRate === 1, 'deploy passRate 1/1');

  // Garbled-line tolerance via readTelemetry against a temp dir. Clear any prior
  // run's file first so the test is idempotent (appendFileSync would accumulate).
  const os = await import('node:os');
  const { rmSync } = await import('node:fs');
  const tmp = join(os.tmpdir(), 'bp-telemetry-selftest');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, '.blueprint'), { recursive: true });
  const tp = join(tmp, TELEMETRY_REL);
  appendFileSync(tp, JSON.stringify({ stage: 'x', duration_ms: 1 }) + '\n');
  appendFileSync(tp, '{ not json\n');
  appendFileSync(tp, '\n');
  appendFileSync(tp, JSON.stringify({ stage: 'x', duration_ms: 3 }) + '\n');
  const read = readTelemetry(tmp);
  assert(read.length === 2, 'readTelemetry skips garbled + blank lines');

  // appendTelemetry stamps ts + fills nulls.
  const w = appendTelemetry(tmp, { stage: 'y', effort: 'high' }, '2026-06-04T00:00:00Z');
  assert(w.ts === '2026-06-04T00:00:00Z' && w.model_tier === null && w.duration_ms === null, 'appendTelemetry stamps + nulls');

  // Absent file → [].
  assert(readTelemetry(join(os.tmpdir(), 'bp-telemetry-absent-xyz')).length === 0, 'absent telemetry → []');

  console.log('telemetry self-test: PASS (12 assertions)');
}
