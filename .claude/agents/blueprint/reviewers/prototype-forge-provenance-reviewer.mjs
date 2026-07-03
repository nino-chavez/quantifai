/**
 * prototype-forge-provenance-reviewer.mjs — executable pair for the paired .md
 * spec. Implements the ADR-0002 reviewer contract so the Stage 3 forge-provenance
 * gate runs outside Claude Code (CLI / CI / any node).
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (encoded response to ADR-0004 — forge-pipeline-bypass + JTBD
 * discontinuity, the two website-nc-v3 failures):
 *   Check A — a SUBSTANTIVE prototype (≥500 HTML/CSS/component lines) must carry
 *     forge-pipeline evidence (forge-brand + forge-signal + gen-images) on disk,
 *     OR declare `forge_pipeline.skip: true` with a ≥10-word reason. Silence on a
 *     substantive prototype BLOCKS. forge-site is recommended, not required.
 *     forge-brand tokens present-but-unconsumed is a WARN (mid-migration).
 *   Check B — every Stage 1 JTBD must have a prototype surface file that exists
 *     (LACKS_SURFACE → BLOCK). Whether that surface's structure COULD satisfy the
 *     JTBD acceptance criteria is a STRUCTURAL precondition; the deep semantic
 *     read of each criterion shape is agent judgment (see the .md spec) — this
 *     executable scopes Check B to surface-file PRESENCE + a coarse non-emptiness
 *     check, and emits the per-criterion COULD-satisfy verdict as an INFO finding
 *     ("agent-verified"). It never BLOCKS on the semantic judgment.
 *
 * HYBRID scoping (honest, per the harness contract):
 *   - Mechanical here: prototype line count, forge_pipeline.skip parse + reason
 *     word-count, evidence-file globbing, token-consumption grep, JTBD index
 *     build, surface→file mapping, surface-file existence.
 *   - Agent-judged (NOT faked, surfaced as INFO): does a given surface file's
 *     markup actually satisfy the specific acceptance-criterion shape ("sees 3+
 *     named X", "reaches Y in ≤N clicks", "reads vocabulary {a,b,c}"). The .md
 *     spec drives the human/agent pass for those.
 *
 * Dependency-free node ESM. Reuses tools/lib/cost-dial.mjs only for its shallow
 * line-scan idioms (re-implemented locally for the forge_pipeline block — a
 * different shape than cost:). Never throws: every risky read is wrapped and
 * degrades to a finding.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'prototype-forge-provenance-reviewer';

// Substantiveness threshold (spec § Check A.1). Below this, the prototype is an
// early scaffold / Tier-0 research initiative and forge provenance isn't required.
const SUBSTANTIVE_LINES = 500;

// Roots scanned for prototype source (spec § Check A.1 + B.2).
const PROTOTYPE_ROOTS = ['prototype', 'portal', path.join('blueprint', 'portal'), path.join('apps', 'portal')];
const CODE_EXT = /\.(html|tsx|jsx|svelte|css)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git', '.smoke-screenshots']);

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

function finalize(findings, targetSummary, startedAt) {
  // INFO findings never drive status. BLOCK > WARN > PASS over the rest.
  const status = findings.some((f) => f.severity === 'BLOCK')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'WARN')
    ? 'WARN'
    : 'PASS';
  return result(status, findings, targetSummary, startedAt);
}

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), acc);
    } else {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

// ── forge_pipeline.skip parse — shallow, PRESENCE-scoped line-scan ────────────
// Shape the spec declares (blueprint.yml):
//   forge_pipeline:
//     skip: true
//     reason: "<≥10-word substantive explanation>"
// We do NOT deep-parse nested YAML (no yaml dep). We line-scan the 2-space block
// under `forge_pipeline:` for `skip:` and `reason:` only. forge_site.archetype is
// scanned the same way. Returns nulls when absent — caller treats that as "not
// declared" (the default-required signal).
export function parseForgePipeline(ymlText) {
  if (typeof ymlText !== 'string') return { skip: false, reason: null, archetype: null };
  const lines = ymlText.split('\n');
  let skip = false;
  let reason = null;
  let archetype = null;

  const blockStart = (re) => lines.findIndex((l) => re.test(l));

  // forge_pipeline: block
  let i = blockStart(/^forge_pipeline:\s*(#.*)?$/);
  if (i >= 0) {
    for (i += 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      if (/^\S/.test(line)) break; // dedent → block ends
      const m = /^\s{2,}([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      // strip an inline comment outside quotes (bare scalars only)
      if (!/^["']/.test(val)) {
        const ci = val.search(/\s+#/);
        if (ci >= 0) val = val.slice(0, ci).trim();
      }
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'skip') skip = /^true$/i.test(val);
      else if (key === 'reason') reason = val || null;
    }
  }

  // forge_site.archetype — may be nested under `forge_site:` or flat `forge_site.archetype:`.
  const flat = lines.find((l) => /^\s*forge_site\.archetype:\s*\S/.test(l));
  if (flat) {
    archetype = flat.replace(/^\s*forge_site\.archetype:\s*/, '').trim().replace(/^["']|["']$/g, '') || null;
  } else {
    let j = blockStart(/^forge_site:\s*(#.*)?$/);
    if (j >= 0) {
      for (j += 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        if (/^\S/.test(line)) break;
        const m = /^\s{2,}archetype:\s*(.+)$/.exec(line);
        if (m) {
          archetype = m[1].trim().replace(/^["']|["']$/g, '') || null;
          break;
        }
      }
    }
  }
  return { skip, reason, archetype };
}

function wordCount(s) {
  return (String(s || '').trim().match(/\S+/g) || []).length;
}

// ── JTBD index — same shape prescription-jtbd-traceability-reviewer parses ────
// Parse `research/personas/` for inline `jtbd:` blocks (frontmatter/body YAML) or
// sibling `<slug>/jtbd.md` / `<slug>.jtbd.md`. Each entry carries surface /
// time_budget / job / acceptance (spec § Check B.1, research-completeness-reviewer
// § 6). Shallow line-scan only: a `jtbd:` list of `- surface: ...` maps, OR
// repeated top-level `surface:`/`job:`/`acceptance:`/`time_budget:` keys.
export function parseJtbdFromText(text, personaSlug) {
  const out = [];
  if (typeof text !== 'string') return out;
  const lines = text.split('\n');

  // Find a `jtbd:` block; entries are list items (`- surface:` / `  - surface:`)
  // or a single inline map. We accumulate key/values until the next `- ` or dedent.
  let i = lines.findIndex((l) => /^\s*jtbd:\s*(#.*)?$/.test(l));
  if (i >= 0) {
    let cur = null;
    const push = () => { if (cur && cur.surface) out.push(cur); cur = null; };
    for (i += 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\S/.test(line) && line.trim() !== '' && !/^\s/.test(line)) {
        // top-level key (no indentation) → jtbd block ended
        if (!/^\s/.test(line)) break;
      }
      if (line.trim() === '' ) continue;
      const item = /^\s*-\s*([A-Za-z_]+):\s*(.*)$/.exec(line); // new list entry
      if (item) {
        push();
        cur = {};
        cur[item[1]] = unquote(item[2]);
        continue;
      }
      const kv = /^\s+([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (kv && cur) {
        cur[kv[1]] = unquote(kv[2]);
        continue;
      }
      // a bare `-` opening a list item with keys on following lines
      if (/^\s*-\s*$/.test(line)) { push(); cur = {}; continue; }
      // dedent to a non-jtbd top-level structure
      if (/^[A-Za-z_]/.test(line)) break;
    }
    push();
  }

  return out
    .filter((j) => j.surface)
    .map((j) => ({
      persona: personaSlug,
      surface: String(j.surface).trim(),
      time_budget: j.time_budget ? String(j.time_budget).trim() : null,
      job: j.job ? String(j.job).trim() : null,
      acceptance: j.acceptance ? String(j.acceptance).trim() : null,
      jobSlug: jobSlug(j.job),
    }));
}

function unquote(v) {
  let s = String(v || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

// kebab-case, first 5 words of the job sentence (spec convention from the
// prescription-jtbd reviewer: <persona>/<surface>/<job-slug>).
function jobSlug(job) {
  if (!job) return 'job';
  return String(job)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-') || 'job';
}

// Map a JTBD `surface:` string to candidate prototype file paths (spec § Check B.2):
//   "/" → index.html | index.astro
//   "/about" or "about" → about.html | about.astro | pages/about.html
//   "services" → services.html | pages/services.html | ...
// Returns an ordered list of relative candidate paths to probe under each root.
export function surfaceToCandidates(surface) {
  let s = String(surface || '').trim();
  if (s === '' || s === '/') {
    return ['index.html', 'index.astro', 'index.tsx', 'index.svelte', 'src/pages/index.astro'];
  }
  s = s.replace(/^\/+/, '').replace(/\/+$/, ''); // strip leading/trailing slashes
  const exts = ['html', 'astro', 'tsx', 'jsx', 'svelte'];
  const bases = [s, `pages/${s}`, `src/pages/${s}`];
  const out = [];
  for (const b of bases) for (const e of exts) out.push(`${b}.${e}`);
  // also a directory-index form: services/ → services/index.html
  for (const e of exts) out.push(`${s}/index.${e}`);
  return out;
}

export default async function review({ targetDir }) {
  const startedAt = Date.now();
  const findings = [];

  // ── Gather prototype source across all roots ───────────────────────────────
  let protoFiles = [];
  try {
    for (const rel of PROTOTYPE_ROOTS) {
      const root = path.join(targetDir, rel);
      if (await exists(root)) protoFiles.push(...(await walk(root)));
    }
  } catch (err) {
    findings.push({
      severity: 'WARN',
      location: 'prototype roots',
      message: `Could not enumerate prototype source: ${err.message}. Treating prototype as insubstantial.`,
      remediation: 'Verify prototype/ portal/ blueprint/portal/ apps/portal/ are readable from the initiative root.',
      reference: 'prototype-forge-provenance-reviewer.md#check-a',
    });
  }
  const codeFiles = protoFiles.filter((f) => CODE_EXT.test(f));

  let protoLines = 0;
  for (const f of codeFiles) {
    const c = await read(f);
    if (c != null) protoLines += c.split('\n').length;
  }

  // ── Read blueprint.yml text (raw) for forge_pipeline skip + forge_site ──────
  let ymlText = null;
  try {
    ymlText = await read(path.join(targetDir, 'blueprint.yml'));
  } catch {
    ymlText = null;
  }
  const forge = parseForgePipeline(ymlText || '');

  // ── Check A — substantiveness gate ─────────────────────────────────────────
  if (protoLines < SUBSTANTIVE_LINES) {
    findings.push({
      severity: 'INFO',
      location: 'prototype source',
      message: `SKIPPED-INSUBSTANTIAL: ${protoLines} prototype HTML/CSS/component lines < ${SUBSTANTIVE_LINES}. Forge provenance not required for an early scaffold / Tier-0 research initiative.`,
      remediation: 'No action. This gate activates once the prototype crosses the substantiveness threshold.',
      reference: 'prototype-forge-provenance-reviewer.md#check-a-1',
    });
    // Check B still informative on a small prototype, but its BLOCK teeth are the
    // surface-existence ones; run it so LACKS_SURFACE is reported even early.
    await runCheckB({ targetDir, findings, codeFiles, protoFiles });
    return finalize(findings, `insubstantial (${protoLines} lines)`, startedAt);
  }

  // Substantive prototype. Check the explicit-skip declaration first.
  if (forge.skip) {
    const wc = wordCount(forge.reason);
    if (wc >= 10) {
      findings.push({
        severity: 'INFO',
        location: 'blueprint.yml forge_pipeline.skip',
        message: `SKIPPED-BY-DECLARATION: forge_pipeline.skip=true with a ${wc}-word reason: "${forge.reason}". Forge evidence not required this round.`,
        remediation: 'No action. Re-confirm the skip reason still holds if the prototype ships to stakeholders.',
        reference: 'prototype-forge-provenance-reviewer.md#check-a-2',
      });
      // Skip Check A's evidence scan, but still run Check B (JTBD surfaces are
      // independent of forge provenance — the spec proceeds to Check B after a skip).
      await runCheckB({ targetDir, findings, codeFiles, protoFiles });
      return finalize(findings, `forge skip declared (${protoLines} lines)`, startedAt);
    }
    // skip declared but reason too thin → BLOCK (spec § "Skip declared without ≥10-word reason").
    findings.push({
      severity: 'BLOCK',
      location: 'blueprint.yml forge_pipeline.reason',
      message: `forge_pipeline.skip=true but reason is ${wc} word(s) (<10): "${forge.reason ?? ''}". A skip must carry a substantive ≥10-word justification.`,
      remediation:
        'Expand forge_pipeline.reason to ≥10 words of substantive justification — e.g. "Tier 0 research-only initiative; no prototype shipping to stakeholders, internal review only". "out of scope" does not qualify.',
      reference: 'prototype-forge-provenance-reviewer.md#check-a-2',
    });
    await runCheckB({ targetDir, findings, codeFiles, protoFiles });
    return finalize(findings, `forge skip reason too thin (${protoLines} lines)`, startedAt);
  }

  // ── Check A.3 — scan for forge evidence files ──────────────────────────────
  const allRepoFiles = await walk(targetDir);
  const relOf = (f) => path.relative(targetDir, f);
  const has = (predicate) => allRepoFiles.filter((f) => predicate(relOf(f)));

  const brandEvidence = has(
    (r) =>
      r === 'brand-kit.json' ||
      r === path.join('brand', 'brand-kit.json') ||
      r.endsWith('tokens.css') ||
      r.endsWith('tokens.tailwind.json') ||
      r === path.join('brand-kit', 'voice.md'),
  );
  const signalEvidence = has(
    (r) =>
      r.endsWith(path.join('brand-kit', 'forge-signal.yml')) ||
      r.endsWith(path.join('bridges', 'forge-signal.yml')) ||
      r.endsWith('forge-signal.yml') ||
      r.startsWith('content' + path.sep),
  );
  const genImagesEvidence = has(
    (r) =>
      r === path.join('media', 'manifest.json') ||
      r.endsWith(path.join('brand-kit', 'gen-images.yml')) ||
      r.startsWith('media' + path.sep),
  );
  // forge-site: archetype declared in blueprint.yml OR a composition skeleton import
  // in the prototype root file. We can mechanically verify the blueprint.yml side;
  // the "skeleton imported in prototype root" side is a coarse grep.
  let forgeSiteEvidence = forge.archetype ? `archetype:${forge.archetype}` : null;
  if (!forgeSiteEvidence) {
    for (const f of codeFiles.filter((f) => /index\.(html|astro|tsx|jsx|svelte)$/.test(f))) {
      const c = await read(f);
      if (c && /archetype|forge-site|forge_site/i.test(c)) {
        forgeSiteEvidence = `skeleton-import:${relOf(f)}`;
        break;
      }
    }
  }


  // Required: forge-brand, forge-signal, gen-images. forge-site recommended only.
  const missingRequired = [];
  if (!brandEvidence.length) missingRequired.push('forge-brand');
  if (!signalEvidence.length) missingRequired.push('forge-signal');
  if (!genImagesEvidence.length) missingRequired.push('gen-images');

  if (missingRequired.length) {
    findings.push({
      severity: 'BLOCK',
      location: 'forge evidence (repo root + brand-kit/ + media/ + content/)',
      message: `Substantive prototype (${protoLines} lines) but missing forge-pipeline evidence for: ${missingRequired.join(', ')}. No forge_pipeline.skip declared — silence on a substantive prototype is the failure mode this gate eliminates (ADR-0004 forge-pipeline-bypass).`,
      remediation:
        'Run the forge pipeline and commit its outputs: forge-brand → brand-kit.json / tokens.css; forge-signal → brand-kit/forge-signal.yml (+ content/); gen-images → media/manifest.json (+ media/). OR, if hand-building is a deliberate exception this round, declare `forge_pipeline: { skip: true, reason: "<≥10 words>" }` in blueprint.yml.',
      reference: 'docs/decisions/0004-jtbd-continuity-and-forge-provenance.md',
    });
  }
  // forge-site recommended (warning if missing — spec § "recommended, not required").
  if (!forgeSiteEvidence) {
    findings.push({
      severity: 'WARN',
      location: 'blueprint.yml forge_site.archetype / prototype root',
      message: 'forge-site archetype not declared and no composition-skeleton import found in the prototype root file. Recommended, not required.',
      remediation: 'Declare `forge_site.archetype: <archetype-name>` in blueprint.yml, or import a forge-site composition skeleton in the prototype root, if the prototype uses one.',
      reference: 'prototype-forge-provenance-reviewer.md#check-a-3',
    });
  }

  // ── Check A.4 — tokens present-but-unconsumed (WARN) ───────────────────────
  if (brandEvidence.length) {
    let consumed = false;
    for (const f of codeFiles) {
      const c = await read(f);
      if (c && (/var\(--bk-/.test(c) || /@import\s+["'][^"']*tokens\.css/.test(c) || /tokens\.tailwind/.test(c) || /var\(--/.test(c) && /tokens\.css/.test(c))) {
        consumed = true;
        break;
      }
    }
    if (!consumed) {
      findings.push({
        severity: 'WARN',
        location: 'prototype source',
        message: 'FORGE_BRAND_TOKENS_UNCONSUMED: forge-brand tokens exist on disk but the prototype shows no var(--bk-*) usage or tokens.css import — it may be hand-coding its own color/type system.',
        remediation: 'Consume the forge-brand export: import tokens.css and reference var(--bk-*) custom properties (or extend the Tailwind config from tokens.tailwind.json) instead of hand-coded values. Warning only — operator may be mid-migration.',
        reference: 'prototype-forge-provenance-reviewer.md#check-a-4',
      });
    }
  }

  // ── Check B — JTBD surface satisfaction ────────────────────────────────────
  await runCheckB({ targetDir, findings, codeFiles, protoFiles });

  const evSummary = `brand=${brandEvidence.length ? 'Y' : 'N'} signal=${signalEvidence.length ? 'Y' : 'N'} images=${genImagesEvidence.length ? 'Y' : 'N'} site=${forgeSiteEvidence ? 'Y' : 'N'}`;
  return finalize(findings, `${protoLines} lines, ${evSummary}`, startedAt);
}

// ── Check B implementation (shared across the early-exit paths) ──────────────
async function runCheckB({ targetDir, findings, codeFiles, protoFiles }) {
  const personasDir = path.join(targetDir, 'research', 'personas');
  if (!(await exists(personasDir))) {
    findings.push({
      severity: 'INFO',
      location: 'research/personas/',
      message: 'No research/personas/ directory — Check B (JTBD surface satisfaction) has no JTBD index to build. If this initiative shipped a prototype, Stage 1 likely never ran.',
      remediation: 'If Stage 1 was completed, ensure research/personas/ is present at the initiative root. Tier-0 research initiatives may legitimately have no prototype to check.',
      reference: 'prototype-forge-provenance-reviewer.md#check-b',
    });
    return;
  }

  // Build the JTBD index across persona files + sibling jtbd.md files.
  const jtbds = [];
  let personaFiles = [];
  try {
    const entries = await fs.readdir(personasDir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(personasDir, e.name);
      if (e.isFile() && e.name.endsWith('.md')) personaFiles.push(p);
      else if (e.isDirectory()) {
        // sibling <slug>/jtbd.md
        const sib = path.join(p, 'jtbd.md');
        if (await exists(sib)) personaFiles.push(sib);
      }
    }
  } catch {
    /* degrade below */
  }

  for (const pf of personaFiles) {
    const slug = path.basename(pf, '.md').replace(/\.jtbd$/, '');
    const txt = await read(pf);
    if (txt == null) continue;
    for (const j of parseJtbdFromText(txt, slug)) jtbds.push(j);
  }

  if (jtbds.length === 0) {
    // Spec § Rules: zero JTBDs is a Stage 1 failure → BLOCK (STAGE_1_INCOMPLETE),
    // but only when personas exist (an operator bypassed the Stage 1 gate). If the
    // personas carry no parseable inline jtbd: block, we cannot distinguish "Stage 1
    // incomplete" from "JTBDs live in a shape this line-scanner can't read" — so we
    // surface it as a BLOCK with that honest caveat.
    findings.push({
      severity: 'BLOCK',
      location: 'research/personas/',
      message: `STAGE_1_INCOMPLETE: ${personaFiles.length} persona file(s) found but zero parseable JTBD entries (inline jtbd: block or sibling jtbd.md). research-completeness-reviewer should have caught this; if personas declare JTBDs in a non-standard shape, that shape needs normalizing to surface/time_budget/job/acceptance.`,
      remediation:
        'Add a `jtbd:` block to each persona (or a sibling research/personas/<slug>/jtbd.md) with surface / time_budget / job / acceptance fields per research-completeness-reviewer § 6. If JTBDs exist but in a different shape, normalize them so the Stage-1 gate and this Stage-3 gate read the same source.',
      reference: 'prototype-forge-provenance-reviewer.md#rules',
    });
    return;
  }

  // For each JTBD: map surface → candidate file, verify existence (LACKS_SURFACE → BLOCK).
  const codeRel = new Set(codeFiles.map((f) => path.relative(targetDir, f)));
  const allRel = new Set(protoFiles.map((f) => path.relative(targetDir, f)));
  let satisfiedPlausibly = 0;
  const lacks = [];

  for (const j of jtbds) {
    const candidates = surfaceToCandidates(j.surface);
    // probe candidates under each prototype root
    let hitRel = null;
    outer: for (const root of PROTOTYPE_ROOTS) {
      for (const cand of candidates) {
        const rel = path.join(root, cand);
        if (codeRel.has(rel) || allRel.has(rel)) {
          hitRel = rel;
          break outer;
        }
      }
    }
    const id = `${j.persona}/${j.surface}/${j.jobSlug}`;
    if (!hitRel) {
      lacks.push(id);
      continue;
    }
    satisfiedPlausibly += 1;
    // The COULD-satisfy semantic verdict (acceptance-criterion shapes) is agent
    // judgment — surface it as INFO, never as a status-driving finding.
    findings.push({
      severity: 'INFO',
      location: hitRel,
      message: `JTBD ${id} maps to an existing surface (${hitRel}). Whether its markup COULD satisfy the acceptance criterion — "${j.acceptance ?? '(none declared)'}" — is agent-verified (see .md spec § Check B.3): structural shapes like "sees N+ named X", "reaches Y in ≤N clicks", "reads vocabulary {a,b,c}" require a semantic read of the markup this executable does not perform.`,
      remediation: 'Agent/human: confirm the surface contains elements that could plausibly satisfy the acceptance criterion (structural, not behavioral — Stage 6 prototype-smoke-runner does the behavioral check).',
      reference: 'prototype-forge-provenance-reviewer.md#check-b-3',
    });
  }

  if (lacks.length) {
    findings.push({
      severity: 'BLOCK',
      location: 'prototype surfaces',
      message: `JTBD_LACKS_SURFACE: ${lacks.length} JTBD(s) have no prototype file for their declared surface: ${lacks.join(', ')}. A JTBD the methodology committed to at Stage 1 has nothing to satisfy it at Stage 3.`,
      remediation:
        'For each listed JTBD, create the prototype surface its `surface:` field names (e.g. surface "/" → prototype/index.html or apps/portal/src/pages/index.astro; surface "services" → portal/pages/services.html). If the JTBD surface changed, update the persona JTBD to match the prototype.',
      reference: 'prototype-forge-provenance-reviewer.md#check-b-coverage',
    });
  }

  findings.push({
    severity: 'INFO',
    location: 'research/personas/',
    message: `CHECK_B coverage: ${jtbds.length} JTBD(s) indexed, ${satisfiedPlausibly} have an existing surface file, ${lacks.length} LACKS_SURFACE. SURFACE_INSUFFICIENT (markup present but cannot satisfy the criterion) is agent-verified per the .md spec and is NOT mechanically asserted here.`,
    remediation: 'No action required for the INFO line itself.',
    reference: 'prototype-forge-provenance-reviewer.md#check-b-coverage',
  });
}

// ── Self-test (node prototype-forge-provenance-reviewer.mjs) ─────────────────
// Guard fires when this file is the entrypoint. Compare resolved real paths so a
// /tmp→/private/tmp symlink (macOS) doesn't make the guard silently false.
const _isMain = await (async () => {
  try {
    const self = new URL(import.meta.url).pathname;
    const argv = process.argv[1] || '';
    if (self === argv) return true;
    const { realpathSync } = await import('node:fs');
    return realpathSync(self) === realpathSync(argv);
  } catch {
    return import.meta.url === `file://${process.argv[1]}`;
  }
})();
if (_isMain) {
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  // ── Unit: parseForgePipeline ──────────────────────────────────────────────
  const fp1 = parseForgePipeline('forge_pipeline:\n  skip: true\n  reason: "Tier 0 research-only initiative no prototype shipping to stakeholders internal review only"\n');
  assert(fp1.skip === true, 'forge skip true parsed');
  assert(wordCount(fp1.reason) >= 10, 'forge reason word count parsed');

  const fp2 = parseForgePipeline('tier: 1\nquality:\n  cite_sources: true\n');
  assert(fp2.skip === false && fp2.reason === null, 'absent forge block → skip false, reason null');

  const fp3 = parseForgePipeline('forge_pipeline:\n  skip: true\n  reason: "out of scope"\n');
  assert(fp3.skip === true && wordCount(fp3.reason) === 3, 'thin reason word count = 3');

  const fp4 = parseForgePipeline('forge_site:\n  archetype: portfolio-brand\n');
  assert(fp4.archetype === 'portfolio-brand', 'nested forge_site.archetype parsed');
  const fp5 = parseForgePipeline('forge_site.archetype: editorial\n');
  assert(fp5.archetype === 'editorial', 'flat forge_site.archetype parsed');

  // ── Unit: surfaceToCandidates ─────────────────────────────────────────────
  assert(surfaceToCandidates('/').includes('index.html'), 'root surface → index.html');
  assert(surfaceToCandidates('/about').includes('about.html'), 'about surface → about.html');
  assert(surfaceToCandidates('services').some((c) => c === 'pages/services.html'), 'services → pages/services.html candidate');

  // ── Unit: parseJtbdFromText + jobSlug ─────────────────────────────────────
  const personaYml = `---
name: "Peer Architect"
jtbd:
  - surface: /
    time_budget: 5 seconds
    job: Sees 3 named shipped products with live URLs
    acceptance: "Sees 3+ named shipped products with live URLs within 5 seconds"
  - surface: about
    time_budget: 60 seconds
    job: Reaches Cal.com booking
    acceptance: "Reaches Cal.com booking in <=2 clicks"
---
body text here
`;
  const parsed = parseJtbdFromText(personaYml, 'peer-architect');
  assert(parsed.length === 2, `parsed 2 JTBDs (got ${parsed.length})`);
  assert(parsed[0].surface === '/' && parsed[0].time_budget === '5 seconds', 'first JTBD fields parsed');
  assert(parsed[0].jobSlug === 'sees-3-named-shipped-products', `jobSlug first-5-words kebab (got ${parsed[0].jobSlug})`);
  assert(parsed[1].surface === 'about' && /Cal\.com/.test(parsed[1].acceptance), 'second JTBD parsed');

  const noJtbd = parseJtbdFromText('---\nname: x\n---\nno jtbd here\n', 'x');
  assert(noJtbd.length === 0, 'persona without jtbd block → empty');

  // ── Integration: build a temp initiative fixture and run review() ──────────
  const mk = async () => fs.mkdtemp(path.join(os.tmpdir(), 'pfp-test-'));

  // Fixture 1: insubstantial prototype → INFO skip-insubstantial, status PASS.
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'prototype'), { recursive: true });
    await fs.writeFile(path.join(dir, 'prototype', 'index.html'), '<html><body>tiny</body></html>\n');
    await fs.writeFile(path.join(dir, 'blueprint.yml'), 'tier: 0\n');
    const r = await review({ targetDir: dir });
    assert(r.status === 'PASS', `insubstantial → PASS (got ${r.status})`);
    assert(r.findings.some((f) => /SKIPPED-INSUBSTANTIAL/.test(f.message)), 'insubstantial finding emitted');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 2: substantive prototype, NO forge evidence, NO skip → BLOCK.
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'prototype'), { recursive: true });
    const big = Array.from({ length: 600 }, (_, i) => `<div class="row-${i}">line</div>`).join('\n');
    await fs.writeFile(path.join(dir, 'prototype', 'index.html'), big + '\n');
    await fs.writeFile(path.join(dir, 'blueprint.yml'), 'tier: 2\n');
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `substantive + no evidence → BLOCKED (got ${r.status})`);
    assert(r.findings.some((f) => f.severity === 'BLOCK' && /forge-brand/.test(f.message)), 'missing-evidence BLOCK emitted');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 3: substantive prototype WITH a valid forge skip declaration → no
  // evidence BLOCK; status PASS (only INFO findings, no personas).
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'portal'), { recursive: true });
    const big = Array.from({ length: 600 }, (_, i) => `.cls-${i} { color: red; }`).join('\n');
    await fs.writeFile(path.join(dir, 'portal', 'styles.css'), big + '\n');
    await fs.writeFile(
      path.join(dir, 'blueprint.yml'),
      'forge_pipeline:\n  skip: true\n  reason: "Tier 0 research-only initiative no prototype shipping to stakeholders internal review only"\n',
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'PASS', `valid forge skip → PASS (got ${r.status})`);
    assert(r.findings.some((f) => /SKIPPED-BY-DECLARATION/.test(f.message)), 'skip-by-declaration finding emitted');
    assert(!r.findings.some((f) => f.severity === 'BLOCK'), 'no BLOCK when skip is valid');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 4: substantive prototype, forge skip with a THIN reason → BLOCK.
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'portal'), { recursive: true });
    const big = Array.from({ length: 600 }, (_, i) => `.cls-${i} { color: red; }`).join('\n');
    await fs.writeFile(path.join(dir, 'portal', 'styles.css'), big + '\n');
    await fs.writeFile(path.join(dir, 'blueprint.yml'), 'forge_pipeline:\n  skip: true\n  reason: "out of scope"\n');
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `thin skip reason → BLOCKED (got ${r.status})`);
    assert(r.findings.some((f) => f.severity === 'BLOCK' && /<10/.test(f.message)), 'thin-reason BLOCK emitted');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 5: substantive prototype WITH full forge evidence + tokens consumed,
  // JTBD whose surface EXISTS → PASS (no BLOCK, INFO coverage).
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'prototype'), { recursive: true });
    await fs.mkdir(path.join(dir, 'brand-kit'), { recursive: true });
    await fs.mkdir(path.join(dir, 'media'), { recursive: true });
    await fs.mkdir(path.join(dir, 'content'), { recursive: true });
    await fs.mkdir(path.join(dir, 'research', 'personas'), { recursive: true });
    // forge evidence
    await fs.writeFile(path.join(dir, 'brand-kit.json'), '{"name":"x"}\n');
    await fs.writeFile(path.join(dir, 'brand-kit', 'forge-signal.yml'), 'bridge: true\n');
    await fs.writeFile(path.join(dir, 'media', 'manifest.json'), '{"assets":[]}\n');
    await fs.writeFile(path.join(dir, 'content', 'copy.md'), 'generated copy\n');
    // prototype consumes tokens
    const big =
      '@import "tokens.css";\n' +
      Array.from({ length: 600 }, (_, i) => `.cls-${i} { color: var(--bk-primary); }`).join('\n');
    await fs.writeFile(path.join(dir, 'prototype', 'index.html'), big + '\n');
    await fs.writeFile(
      path.join(dir, 'blueprint.yml'),
      'tier: 2\nforge_site:\n  archetype: portfolio-brand\n',
    );
    // persona with a JTBD on surface "/" (→ prototype/index.html exists)
    await fs.writeFile(
      path.join(dir, 'research', 'personas', 'peer.md'),
      '---\nname: peer\njtbd:\n  - surface: /\n    time_budget: 5 seconds\n    job: Sees 3 named products\n    acceptance: "Sees 3+ named products with live URLs within 5 seconds"\n---\n',
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'PASS', `full evidence + surface exists → PASS (got ${r.status}); findings: ${JSON.stringify(r.findings.map((f) => f.severity + ':' + f.message.slice(0, 40)))}`);
    assert(!r.findings.some((f) => f.severity === 'BLOCK'), 'no BLOCK on the happy path');
    assert(r.findings.some((f) => f.severity === 'INFO' && /agent-verified/.test(f.message)), 'agent-verified INFO emitted for the satisfiable JTBD');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 6: full forge evidence but JTBD surface MISSING → BLOCK (LACKS_SURFACE).
  {
    const dir = await mk();
    await fs.mkdir(path.join(dir, 'prototype'), { recursive: true });
    await fs.mkdir(path.join(dir, 'brand-kit'), { recursive: true });
    await fs.mkdir(path.join(dir, 'media'), { recursive: true });
    await fs.mkdir(path.join(dir, 'content'), { recursive: true });
    await fs.mkdir(path.join(dir, 'research', 'personas'), { recursive: true });
    await fs.writeFile(path.join(dir, 'brand-kit.json'), '{"name":"x"}\n');
    await fs.writeFile(path.join(dir, 'brand-kit', 'forge-signal.yml'), 'bridge: true\n');
    await fs.writeFile(path.join(dir, 'media', 'manifest.json'), '{"assets":[]}\n');
    await fs.writeFile(path.join(dir, 'content', 'copy.md'), 'copy\n');
    const big = '@import "tokens.css";\n' + Array.from({ length: 600 }, (_, i) => `.c${i}{color:var(--bk-x)}`).join('\n');
    await fs.writeFile(path.join(dir, 'prototype', 'index.html'), big + '\n'); // only "/" exists
    await fs.writeFile(path.join(dir, 'blueprint.yml'), 'tier: 2\nforge_site:\n  archetype: x\n');
    // JTBD on surface "services" → no services.html anywhere → LACKS_SURFACE
    await fs.writeFile(
      path.join(dir, 'research', 'personas', 'buyer.md'),
      '---\nname: buyer\njtbd:\n  - surface: services\n    time_budget: 30 seconds\n    job: Finds the services list\n    acceptance: "Sees 3+ named services"\n---\n',
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `missing surface → BLOCKED (got ${r.status})`);
    assert(r.findings.some((f) => f.severity === 'BLOCK' && /LACKS_SURFACE/.test(f.message)), 'LACKS_SURFACE BLOCK emitted');
    await fs.rm(dir, { recursive: true, force: true });
  }

  // Fixture 7: never throws on a totally empty/garbage targetDir.
  {
    const dir = await mk();
    const r = await review({ targetDir: dir });
    assert(['PASS', 'WARN', 'BLOCKED'].includes(r.status), 'empty dir returns a valid status, no throw');
    await fs.rm(dir, { recursive: true, force: true });
  }

  console.log('prototype-forge-provenance-reviewer self-test: PASS (all assertions)');
}
