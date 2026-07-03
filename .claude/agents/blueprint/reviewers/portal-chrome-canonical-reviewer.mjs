/**
 * portal-chrome-canonical-reviewer.mjs — executable pair for the paired .md spec.
 * Implements the ADR-0002 reviewer contract so the chrome-canonical gate runs
 * outside Claude Code (CLI / CI / any node):
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (encoded response to the 2026-05-25 v3 chrome-drift bug): the ONLY
 * canonical for Pattern B portal chrome is `template/portal/<file>` in this
 * methodology repo. A consumer that drifts a chrome file from that canonical —
 * then lets a peer `curl` the deployed sibling as if it were canonical —
 * propagates project-specific drift no methodology doc ever declared. This
 * reviewer makes that drift mechanically detectable and BLOCKS on it.
 *
 *   - No blueprint/portal|portal dir            -> PASS (not applicable; the spec's
 *                                                  NOT_APPLICABLE, mapped onto the
 *                                                  contract's PASS — see note below).
 *   - Any manifest chrome file DRIFTED/MISSING  -> BLOCK (unless an accepted
 *                                                  divergence ADR names that file).
 *   - project-tokens.css overlay missing        -> BLOCK (no seam for token overrides).
 *   - HTML loads shared.css but not the overlay -> BLOCK (seam not wired into cascade).
 *   - template/portal/<file> missing (canonical -> BLOCK (the methodology repo itself
 *     gone)                                        is broken — surfaced, never silent).
 *
 * Status mapping note: the spec reports STATUS=NOT_APPLICABLE when there is no
 * Pattern B portal. The ADR-0002 contract enum is PASS|BLOCKED|WARN only (the
 * registry/doctor recognize no fourth value), so this reviewer returns PASS with
 * a `not applicable` targetSummary in that case — the same shape cost-gate and
 * pattern-a use for their no-op / tier-0 paths. The not-applicable semantics
 * survive in the summary text, not a new status.
 *
 * Dependency-free node ESM. No npm deps; no nested-YAML parsing (the only YAML
 * touch is a PRESENCE line-scan for `tier:`, declared as such in its finding).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

const NAME = 'portal-chrome-canonical-reviewer';

// Hard-coded mirror of stamp.mjs's PATTERN_B_CHROME_FILES (both profiles).
// Used only as a fallback — the live manifest is parsed out of stamp.mjs at
// runtime. The spec names stamp.mjs as the manifest's source of truth.
// Wave 74 (2026-06-27): two profiles for chrome ownership.
const FALLBACK_CHROME_FILES_PROFILE_A = [
  'shared.css',
  '_portal-shell.js',
  'proto-nav.js',
  'proto-annotate.js',
  'chat-widget.js',
  'theme-switcher.js',
  '_headers',
  '_redirects',
  'docs/index.html',
];

const FALLBACK_CHROME_FILES_PROFILE_B = [
  'canonical-primitives.css',
  '_portal-shell.js',
  'proto-nav.js',
  'proto-annotate.js',
  'chat-widget.js',
  'theme-switcher.js',
  '_headers',
  '_redirects',
  'docs/index.html',
];

// Candidate locations a Pattern B consumer might place its portal. First
// existing dir wins (mirrors stamp.mjs's resolution order + the spec's ls chain).
const PORTAL_CANDIDATES = ['blueprint/portal', 'portal', 'apps/portal'];

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

function finalize(findings, targetSummary, startedAt) {
  const status = findings.some((f) => f.severity === 'BLOCK')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'WARN')
    ? 'WARN'
    : 'PASS';
  return result(status, findings, targetSummary, startedAt);
}

// Resolve the canonical methodology root. Priority: explicit methodologyHome arg,
// then $BLUEPRINT_HOME, then the well-known offset from this file's location
// (.../template/.claude/agents/blueprint/reviewers/ → up 4 → template, up 1 → root).
function resolveMethodologyHome(methodologyHome) {
  if (methodologyHome) return methodologyHome;
  if (process.env.BLUEPRINT_HOME) return process.env.BLUEPRINT_HOME;
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../reviewers
  return path.resolve(here, '..', '..', '..', '..', '..'); // methodology root
}

// Parse both PATTERN_B_CHROME_FILES profiles from stamp.mjs source text.
// Wave 74 (2026-06-27): two profiles for different consumer models.
// Returns { profileA, profileB, source, stampPath }.
// Line-scan, not eval — dep-free and never executes consumer/source code.
async function loadChromeManifests(home) {
  const stampPath = path.join(home, 'template', 'tools', 'blueprint-init', 'stamp.mjs');
  const src = await read(stampPath);

  let profileA = null, profileB = null;
  if (src != null) {
    // Extract Profile A (PATTERN_B_CHROME_FILES_PROFILE_A)
    const mA = src.match(/PATTERN_B_CHROME_FILES_PROFILE_A\s*=\s*\[([\s\S]*?)\]/);
    if (mA) {
      profileA = [...mA[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    }
    // Extract Profile B (PATTERN_B_CHROME_FILES_PROFILE_B)
    const mB = src.match(/PATTERN_B_CHROME_FILES_PROFILE_B\s*=\s*\[([\s\S]*?)\]/);
    if (mB) {
      profileB = [...mB[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    }
  }

  // 'live' only when BOTH profiles parsed from stamp.mjs. Determine this BEFORE
  // assigning fallbacks — otherwise the post-assignment arrays are always non-empty
  // and source could never read 'fallback' (the wave-74 two-profile defect: a
  // hard-coded manifest would mislabel as live, masking a stale/broken stamp.mjs).
  const parsedBoth = profileA != null && profileB != null;
  if (!profileA) profileA = FALLBACK_CHROME_FILES_PROFILE_A;
  if (!profileB) profileB = FALLBACK_CHROME_FILES_PROFILE_B;

  const source = parsedBoth ? 'live' : 'fallback';
  return { profileA, profileB, source, stampPath };
}

// Read chrome_profile from blueprint.yml. Defaults to 'methodology-themed'.
// Wave 74 (2026-06-27): consumer-themed profile allows design-system ownership.
async function readChromeProfile(targetDir) {
  const ymlPath = path.join(targetDir, 'blueprint.yml');
  const yml = await read(ymlPath);
  if (!yml) return 'methodology-themed';

  const lines = yml.split('\n');
  for (const line of lines) {
    const stripped = line.replace(/#.*$/, '').trim();
    const m = stripped.match(/^chrome_profile:\s*["']?([^"'\s]+)["']?\s*$/);
    if (m && m[1]) {
      const val = m[1].toLowerCase();
      if (val === 'consumer-themed' || val === 'methodology-themed') return val;
    }
  }
  return 'methodology-themed';  // default
}

// Count lines that differ between two strings, in the spirit of `diff a b | wc -l`.
// Not a true LCS edit script (dep-free, no diff lib); a positional line compare
// that also accounts for length mismatch. Good enough to quantify "how drifted",
// which is all the report needs — the gate decision is byte-identity, computed
// separately and exactly.
function countDiffLines(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  let diff = 0;
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) diff++;
  }
  return diff;
}

// Find accepted portal-chrome-divergence ADRs across decisions/ and
// blueprint/decisions/. Returns { adrs: [{path, files:[...]}], all: [paths] }.
// Presence + `status: accepted` (or a bare `accepted` line) + a named file is
// what lifts a specific drifted file from BLOCK to WARN.
async function findDivergenceAdrs(targetDir, manifestFiles) {
  const adrs = [];
  for (const rel of ['decisions', path.join('blueprint', 'decisions')]) {
    const dir = path.join(targetDir, rel);
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/portal-chrome-divergence.*\.md$/i.test(name)) continue;
      const full = path.join(dir, name);
      const text = (await read(full)) || '';
      const accepted = /status\s*:\s*accepted\b/i.test(text) || /^\s*accepted\s*$/im.test(text);
      if (!accepted) continue;
      // Which manifest files does this ADR name? (case-insensitive substring match)
      const named = manifestFiles.filter((f) => text.toLowerCase().includes(f.toLowerCase()));
      adrs.push({ path: path.relative(targetDir, full), files: named });
    }
  }
  return adrs;
}

export default async function review({ targetDir, methodologyHome }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  // ── 1. Locate the consumer's Pattern B portal ────────────────────────────
  let portalRel = null;
  for (const cand of PORTAL_CANDIDATES) {
    if (await exists(path.join(artifactsRoot, cand))) {
      portalRel = cand;
      break;
    }
  }
  if (!portalRel) {
    // Spec's NOT_APPLICABLE — no Pattern B portal in this initiative. Mapped to
    // PASS per the contract enum (see header note). Nothing to gate.
    return result('PASS', [], 'not applicable — no blueprint/portal | portal | apps/portal dir', startedAt);
  }
  const portalDir = path.join(artifactsRoot, portalRel);

  // ── 2. Load the canonical chrome manifests and read consumer's profile ─
  const home = resolveMethodologyHome(methodologyHome);
  const templatePortalDir = path.join(home, 'template', 'portal');
  const { profileA, profileB, source: manifestSource, stampPath } = await loadChromeManifests(home);

  // Wave 74: read consumer's chrome_profile to select the correct manifest
  const profile = await readChromeProfile(artifactsRoot);
  const chromeFiles = profile === 'consumer-themed' ? profileB : profileA;

  if (manifestSource === 'fallback') {
    findings.push({
      severity: 'WARN',
      location: stampPath,
      message: `Could not read the live chrome manifest from stamp.mjs; using hard-coded fallback. The diff still runs, but the manifest may be stale. Profile: ${profile}.`,
      remediation: 'Confirm $BLUEPRINT_HOME / methodologyHome points at the methodology repo and that template/tools/blueprint-init/stamp.mjs defines both PATTERN_B_CHROME_FILES_PROFILE_A and PATTERN_B_CHROME_FILES_PROFILE_B.',
      reference: 'template/tools/blueprint-init/stamp.mjs (PATTERN_B_CHROME_FILES_*)',
    });
  }

  if (profile === 'consumer-themed') {
    findings.push({
      severity: 'WARN',
      location: path.join(portalRel, 'shared.css'),
      message: `Chrome profile: consumer-themed (Profile B). Consumer owns shared.css; reviewer enforces byte-identity only on canonical-primitives.css.`,
      remediation: 'Informational. Your shared.css can drift; canonical-primitives.css must match template canonical. See docs/methodology/chrome-profile-pattern.md.',
      reference: 'docs/methodology/chrome-profile-pattern.md',
    });
  }

  // ── 6 (pre-load). Accepted divergence ADRs that can downgrade a drift ──────
  const adrs = await findDivergenceAdrs(artifactsRoot, chromeFiles);
  const adrCoveredFiles = new Set(adrs.flatMap((a) => a.files));

  // ── 3. Diff each chrome file against template canonical ───────────────────
  let matched = 0;
  const drifted = [];
  const consumerMissing = [];
  const templateMissing = [];
  for (const f of chromeFiles) {
    const canonical = path.join(templatePortalDir, f);
    const consumer = path.join(portalDir, f);
    const canonicalText = await read(canonical);
    if (canonicalText == null) {
      templateMissing.push(f);
      findings.push({
        severity: 'BLOCK',
        location: canonical,
        message: `TEMPLATE_MISSING: canonical chrome file '${f}' is absent from template/portal/ — the methodology repo is broken or $BLUEPRINT_HOME is wrong.`,
        remediation: `Verify methodologyHome/$BLUEPRINT_HOME resolves to the Blueprint methodology repo and that template/portal/${f} exists. This is not a consumer defect.`,
        reference: 'template/portal/ (canonical chrome)',
      });
      continue;
    }
    const consumerText = await read(consumer);
    if (consumerText == null) {
      consumerMissing.push(f);
      findings.push({
        severity: 'BLOCK',
        location: path.join(portalRel, f),
        message: `CONSUMER_MISSING: chrome file '${f}' is absent from ${portalRel}/ — an incomplete or hand-rolled portal.`,
        remediation: `Run: node ${path.join(home, 'template/tools/blueprint-init/stamp.mjs')} --mode=restamp-chrome --pattern=B --target=${targetDir}`,
        reference: 'portal-chrome-canonical-reviewer.md#3-diff-each-chrome-file',
      });
      continue;
    }
    // Byte-identical is the gate decision (exact string equality). diff-line
    // count is only for the report's "how far drifted" number.
    if (canonicalText === consumerText) {
      matched++;
      continue;
    }
    const diffLines = countDiffLines(canonicalText, consumerText);
    drifted.push({ file: f, diffLines });
    const covered = adrCoveredFiles.has(f);
    const adrPath = covered ? adrs.find((a) => a.files.includes(f))?.path : null;
    findings.push({
      severity: covered ? 'WARN' : 'BLOCK',
      location: path.join(portalRel, f),
      message: covered
        ? `DRIFTED (ADR-accepted): '${f}' diverges from canonical by ~${diffLines} line(s); divergence declared in ${adrPath}.`
        : `DRIFTED: '${f}' diverges from canonical template/portal/${f} by ~${diffLines} line(s). The only canonical for chrome is the methodology template — deployed siblings are never canonical.`,
      remediation: covered
        ? 'No action required — drift is covered by an accepted divergence ADR. Recheck the ADR still names this file when the template advances.'
        : `Restore the canonical, then commit the diff: node ${path.join(home, 'template/tools/blueprint-init/stamp.mjs')} --mode=restamp-chrome --pattern=B --target=${targetDir}. If a divergence is genuinely needed, write decisions/NNNN-portal-chrome-divergence.md (status: accepted) naming '${f}', the disqualifier, and the alternative.`,
      reference: 'portal-chrome-canonical-reviewer.md#3-diff-each-chrome-file',
    });
  }

  // ── 4. Verify project-tokens.css overlay exists ───────────────────────────
  const overlayPresent = await exists(path.join(portalDir, 'project-tokens.css'));
  if (!overlayPresent) {
    findings.push({
      severity: 'BLOCK',
      location: path.join(portalRel, 'project-tokens.css'),
      message: 'OVERLAY_MISSING: no project-tokens.css — the consumer has no seam for project token overrides, so any token customization lands in shared.css and re-triggers the chrome-drift bug this gate exists to catch.',
      remediation: `Create the overlay from canonical: node ${path.join(home, 'template/tools/blueprint-init/stamp.mjs')} --mode=restamp-chrome --pattern=B --target=${targetDir}`,
      reference: 'portal-chrome-canonical-reviewer.md#4-verify-project-tokenscss-exists',
    });
  }

  // ── 5. Verify HTML pages load both stylesheets ────────────────────────────
  // shared.css loaded but project-tokens.css not = overlay seam exists but is
  // not wired into the cascade.
  const htmlGlobDirs = ['', 'pages', 'docs', 'prototype'];
  const htmlFiles = [];
  for (const sub of htmlGlobDirs) {
    const dir = sub ? path.join(portalDir, sub) : portalDir;
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.endsWith('.html')) htmlFiles.push(path.join(dir, name));
    }
  }
  const htmlMissingOverlay = [];
  for (const html of htmlFiles) {
    const c = (await read(html)) || '';
    const hasShared = /shared\.css/.test(c);
    const hasOverlay = /project-tokens\.css/.test(c);
    if (hasShared && !hasOverlay) {
      const relHtml = path.relative(targetDir, html);
      htmlMissingOverlay.push(relHtml);
      findings.push({
        severity: 'BLOCK',
        location: relHtml,
        message: `OVERLAY_NOT_LOADED: ${relHtml} links shared.css but not project-tokens.css — the overlay seam exists but is not in the cascade, so project token overrides will not apply.`,
        remediation: 'Add `<link rel="stylesheet" href="/project-tokens.css">` immediately after the shared.css link.',
        reference: 'portal-chrome-canonical-reviewer.md#5-verify-html-pages-load-both-stylesheets',
      });
    }
  }

  // ── Report-surface ADR list (informational) ───────────────────────────────
  if (adrs.length) {
    findings.push({
      severity: 'WARN',
      location: adrs.map((a) => a.path).join(', '),
      message: `Accepted portal-chrome-divergence ADR(s): ${adrs.map((a) => `${a.path}${a.files.length ? ` [${a.files.join(', ')}]` : ' (names no manifest file)'}`).join('; ')}.`,
      remediation: 'Informational. An ADR that names a manifest file downgrades that file\'s drift to WARN; an ADR naming no manifest file downgrades nothing.',
      reference: 'portal-chrome-canonical-reviewer.md#6-surface-known-tolerable-exceptions',
    });
  }

  const summary =
    `portal=${portalRel} profile=${profile} manifest=${chromeFiles.length}(${manifestSource}) ` +
    `match=${matched} drift=${drifted.length} consumer-missing=${consumerMissing.length} ` +
    `template-missing=${templateMissing.length} overlay=${overlayPresent ? 'yes' : 'no'} ` +
    `html-missing-overlay=${htmlMissingOverlay.length} adrs=${adrs.length}`;
  return finalize(findings, summary, startedAt);
}

// ── Self-test (node portal-chrome-canonical-reviewer.mjs) ────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  // Build a throwaway methodology home + consumer pair under a temp dir.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-reviewer-'));
  const home = path.join(tmp, 'methodology');
  const tplPortal = path.join(home, 'template', 'portal');
  const stampDir = path.join(home, 'template', 'tools', 'blueprint-init');
  await fs.mkdir(path.join(tplPortal, 'docs'), { recursive: true });
  await fs.mkdir(stampDir, { recursive: true });

  // A small canonical manifest written into a fake stamp.mjs, exercising the
  // runtime parse path (proves we don't rely on the hard-coded fallback).
  const MANIFEST = ['shared.css', '_headers', 'docs/index.html'];
  // Wave 74 two-profile model: loadChromeManifests parses PROFILE_A/PROFILE_B.
  // Default (methodology-themed) scenarios resolve to Profile A; Profile B only
  // needs to exist so the manifest source reads `live`, not `fallback`.
  await fs.writeFile(
    path.join(stampDir, 'stamp.mjs'),
    `const PATTERN_B_CHROME_FILES_PROFILE_A = [\n${MANIFEST.map((f) => `  "${f}",`).join('\n')}\n];\n` +
      `const PATTERN_B_CHROME_FILES_PROFILE_B = [\n  "canonical-primitives.css",\n  "_headers",\n  "docs/index.html",\n];\n`,
  );
  // Canonical chrome contents.
  const canonical = {
    'shared.css': '/* canonical shared */\nbody { margin: 0; }\n',
    '_headers': '/*\n  X-Frame-Options: DENY\n',
    'docs/index.html':
      '<!doctype html>\n<link rel="stylesheet" href="/shared.css">\n<link rel="stylesheet" href="/project-tokens.css">\n',
  };
  for (const [f, c] of Object.entries(canonical)) {
    await fs.writeFile(path.join(tplPortal, f), c);
  }

  // Helper to stamp a fresh consumer that byte-matches canonical.
  async function freshConsumer(rel) {
    const consumer = path.join(tmp, rel);
    const portal = path.join(consumer, 'blueprint', 'portal');
    await fs.mkdir(path.join(portal, 'docs'), { recursive: true });
    for (const [f, c] of Object.entries(canonical)) {
      await fs.writeFile(path.join(portal, f), c);
    }
    await fs.writeFile(path.join(portal, 'project-tokens.css'), ':root{}\n');
    return { consumer, portal };
  }

  // ── A. No portal → PASS (not applicable) ─────────────────────────────────
  const empty = path.join(tmp, 'no-portal');
  await fs.mkdir(empty, { recursive: true });
  let r = await review({ targetDir: empty, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'PASS' && /not applicable/.test(r.metadata.targetSummary), 'A: no portal → PASS not-applicable');
  assert(r.findings.length === 0, 'A: no portal → zero findings');

  // ── B. Clean consumer (byte-identical, overlay present + wired) → PASS ────
  const { consumer: cClean } = await freshConsumer('clean');
  r = await review({ targetDir: cClean, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'PASS', `B: clean consumer → PASS (got ${r.status}: ${JSON.stringify(r.findings)})`);
  assert(/manifest=3\(live\)/.test(r.metadata.targetSummary), 'B: parsed live 3-file manifest from stamp.mjs');
  assert(/match=3/.test(r.metadata.targetSummary), 'B: all 3 files matched');

  // ── C. One drifted file → BLOCKED ────────────────────────────────────────
  const { consumer: cDrift, portal: pDrift } = await freshConsumer('drift');
  await fs.writeFile(path.join(pDrift, 'shared.css'), '/* canonical shared */\nbody { margin: 99px; }\n');
  r = await review({ targetDir: cDrift, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'BLOCKED', 'C: drifted shared.css → BLOCKED');
  const driftF = r.findings.find((f) => f.severity === 'BLOCK' && /DRIFTED: 'shared\.css'/.test(f.message));
  assert(driftF, 'C: emits a DRIFTED BLOCK for shared.css');
  assert(/restamp-chrome/.test(driftF.remediation), 'C: remediation names the restamp fix path');

  // ── D. Drift covered by accepted ADR → WARN (not BLOCK) ───────────────────
  const { consumer: cAdr, portal: pAdr } = await freshConsumer('adr');
  await fs.writeFile(path.join(pAdr, 'shared.css'), '/* canonical shared */\nbody { margin: 99px; }\n');
  await fs.mkdir(path.join(cAdr, 'decisions'), { recursive: true });
  await fs.writeFile(
    path.join(cAdr, 'decisions', '0007-portal-chrome-divergence.md'),
    '---\nstatus: accepted\n---\n# Divergence\nWe diverge shared.css because <reason>.\n',
  );
  r = await review({ targetDir: cAdr, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'WARN', `D: ADR-accepted drift → WARN (got ${r.status})`);
  assert(!r.findings.some((f) => f.severity === 'BLOCK'), 'D: no BLOCK findings when ADR covers the drift');
  assert(r.findings.some((f) => /DRIFTED \(ADR-accepted\)/.test(f.message)), 'D: drift finding marked ADR-accepted');

  // ── E. Proposed (not accepted) ADR does NOT downgrade → BLOCKED ───────────
  const { consumer: cProp, portal: pProp } = await freshConsumer('proposed');
  await fs.writeFile(path.join(pProp, 'shared.css'), '/* canonical shared */\nbody { margin: 99px; }\n');
  await fs.mkdir(path.join(cProp, 'decisions'), { recursive: true });
  await fs.writeFile(
    path.join(cProp, 'decisions', '0008-portal-chrome-divergence.md'),
    '---\nstatus: proposed\n---\n# Divergence\nshared.css.\n',
  );
  r = await review({ targetDir: cProp, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'BLOCKED', 'E: proposed-status ADR does not downgrade → BLOCKED');

  // ── F. Missing overlay → BLOCKED ─────────────────────────────────────────
  const { consumer: cNoOverlay, portal: pNoOverlay } = await freshConsumer('no-overlay');
  await fs.rm(path.join(pNoOverlay, 'project-tokens.css'));
  r = await review({ targetDir: cNoOverlay, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'BLOCKED', 'F: missing project-tokens.css → BLOCKED');
  assert(r.findings.some((f) => /OVERLAY_MISSING/.test(f.message)), 'F: emits OVERLAY_MISSING');

  // ── G. HTML loads shared.css but not overlay → BLOCKED ────────────────────
  const { consumer: cHtml, portal: pHtml } = await freshConsumer('html');
  await fs.writeFile(
    path.join(pHtml, 'docs', 'index.html'),
    '<!doctype html>\n<link rel="stylesheet" href="/shared.css">\n',
  );
  // docs/index.html now also drifts from canonical, so we'd BLOCK regardless;
  // assert the specific OVERLAY_NOT_LOADED finding is present.
  r = await review({ targetDir: cHtml, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'BLOCKED', 'G: html missing overlay → BLOCKED');
  assert(r.findings.some((f) => /OVERLAY_NOT_LOADED/.test(f.message)), 'G: emits OVERLAY_NOT_LOADED');

  // ── H. Consumer missing a manifest file → BLOCKED ─────────────────────────
  const { consumer: cMiss, portal: pMiss } = await freshConsumer('missing');
  await fs.rm(path.join(pMiss, '_headers'));
  r = await review({ targetDir: cMiss, blueprintYml: {}, methodologyHome: home });
  assert(r.status === 'BLOCKED', 'H: consumer-missing chrome file → BLOCKED');
  assert(r.findings.some((f) => /CONSUMER_MISSING: chrome file '_headers'/.test(f.message)), 'H: emits CONSUMER_MISSING');

  // ── I. Unparseable stamp.mjs → fallback manifest + WARN, gate still runs ───
  const homeBadStamp = path.join(tmp, 'badstamp');
  await fs.mkdir(path.join(homeBadStamp, 'template', 'portal', 'docs'), { recursive: true });
  await fs.mkdir(path.join(homeBadStamp, 'template', 'tools', 'blueprint-init'), { recursive: true });
  await fs.writeFile(path.join(homeBadStamp, 'template', 'tools', 'blueprint-init', 'stamp.mjs'), '// no manifest here\n');
  // Provide canonical for one fallback file so the diff path is exercised.
  await fs.writeFile(path.join(homeBadStamp, 'template', 'portal', 'shared.css'), 'x\n');
  const { consumer: cFb } = await freshConsumer('fallback');
  r = await review({ targetDir: cFb, blueprintYml: {}, methodologyHome: homeBadStamp });
  assert(/manifest=\d+\(fallback\)/.test(r.metadata.targetSummary), 'I: falls back when stamp.mjs has no manifest');
  assert(r.findings.some((f) => f.severity === 'WARN' && /hard-coded/.test(f.message)), 'I: warns about fallback manifest');

  // ── J. Never throws on a totally absent methodology home ──────────────────
  const { consumer: cNoHome } = await freshConsumer('nohome');
  r = await review({ targetDir: cNoHome, blueprintYml: {}, methodologyHome: '/no/such/home' });
  assert(['BLOCKED', 'WARN', 'PASS'].includes(r.status), 'J: bad home degrades to a contract status, never throws');
  assert(r.findings.some((f) => /TEMPLATE_MISSING/.test(f.message)), 'J: bad home surfaces TEMPLATE_MISSING blocks');

  await fs.rm(tmp, { recursive: true, force: true });
  console.log('portal-chrome-canonical-reviewer self-test: PASS (10 scenarios)');
}
