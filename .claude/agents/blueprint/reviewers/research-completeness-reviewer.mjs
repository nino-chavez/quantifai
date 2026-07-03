/**
 * research-completeness-reviewer.mjs — executable pair for the paired .md spec.
 * Implements the ADR-0002 reviewer contract so the Stage 1 → Stage 2 gate runs
 * outside Claude Code (CLI / CI / any node):
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (the two self-attestation failures the .md spec encodes):
 *   1. "Stage 1 complete with only some research legs populated" (blog regression):
 *      every variant-required research directory must exist AND hold ≥1 substantive
 *      file (≥500 bytes, not .gitkeep/scaffold). A missing or empty leg → BLOCK.
 *   2. "personas exist but their JTBD is implicit" (website-nc-v3 / ADR-0004):
 *      every persona must declare jtbd with surface/time_budget/job/acceptance, and
 *      every persona-surface pair named in research/funnel/ must have a matching
 *      JTBD entry. Missing JTBD for a funnel surface → BLOCK.
 *   And the platform-feature architect-challenge check (wave 20): when
 *   initiative_type: platform-feature, research/current-state/architectural-options.md
 *   must address all five dimensions, make an explicit choice, and cite sources.
 *
 * HYBRID reviewer (ADR-0002 verdict). This file implements ONLY the mechanical
 * subset — directory/file presence, byte thresholds, field PRESENCE via line-scan,
 * funnel↔JTBD coherence by reference matching, and grep-shaped architect-challenge
 * checks. Criteria that require agent judgment are NOT faked: acceptance-criteria
 * vagueness ("user is satisfied" vs "Sees 3+ products in 5s") and "is the prose an
 * explicit architectural choice" are emitted as INFO findings tagged
 * "agent-verified (see .md spec)" and NEVER drive a BLOCK. The companion .md spec
 * is the authority for those.
 *
 * Parsing honesty: persona JTBD lives in Markdown frontmatter / a `jtbd:` block /
 * a sibling .jtbd.md — nested YAML that a dependency-free line-scan can only read
 * SHALLOWLY. We scope the mechanical check to field-key PRESENCE (does a non-empty
 * `surface:`/`time_budget:`/`job:`/`acceptance:` appear in the persona's JTBD
 * region) and say so in the findings. We do not claim deep schema validation.
 *
 * Dependency-free node ESM. Never throws: every risky read is wrapped and degrades
 * to a BLOCK/WARN finding, matching cost-gate / portal-pattern-a.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

const NAME = 'research-completeness-reviewer';

const SUBSTANTIVE_BYTES = 500; // ≥500 bytes of non-template content = "populated"
const ARTIFACT_BYTES = 1024; // ≥1KB for synthesizing artifacts / architectural-options
const JTBD_FIELDS = ['surface', 'time_budget', 'job', 'acceptance'];

// Required research directories + synthesizing artifacts per variant (.md spec step 2).
const VARIANT_REQUIREMENTS = {
  greenfield: {
    dirs: ['research/current-state', 'research/competitive', 'research/personas', 'research/funnel'],
    artifacts: [],
    requiresJtbd: true,
  },
  midstream: {
    dirs: ['research/current-state', 'research/competitive'],
    artifacts: [],
    requiresJtbd: false, // only for personas the scoped change affects — agent-judged
  },
  brownfield: {
    dirs: ['research/current-state', 'research/personas', 'research/funnel', 'research/competitive'],
    artifacts: ['01-diagnose.md'],
    requiresJtbd: true,
  },
  research: {
    // Research variant: this reviewer gates Stage 2 → 3 (the 3 research legs populated
    // before synthesis/decisions). Persona/JTBD is owned by persona-fit-reviewer, which
    // reads the research schema (JOB-n / acceptance / today / decision-dependency in the
    // single research/personas-and-jtbd.md); the greenfield surface/time_budget JTBD
    // check does NOT apply here and would mis-fire.
    dirs: ['research/problem-space', 'research/competitive', 'research/prior-art'],
    artifacts: [],
    requiresJtbd: false,
  },
};

// Five architect-challenge dimensions (.md spec step 8 / architect-challenge-pattern.md).
const ARCHITECT_DIMENSIONS = [
  { key: 'Expression', re: /expression\s+surface/i },
  { key: 'Validation', re: /validation\s+surface/i },
  { key: 'Authoring', re: /authoring\s+surface/i },
  { key: 'Escape hatch', re: /escape\s*hatch/i },
  { key: 'Evaluation cost', re: /evaluation\s+cost/i },
];

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

// Status is driven ONLY by BLOCK/WARN. INFO findings (agent-judged criteria) never
// move the verdict — that is the HYBRID contract.
function finalize(findings, targetSummary, startedAt) {
  const status = findings.some((f) => f.severity === 'BLOCK')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'WARN')
    ? 'WARN'
    : 'PASS';
  return result(status, findings, targetSummary, startedAt);
}

// ── Minimal scalar reader (cost-dial.mjs readYamlScalar pattern, reused shape) ──
// Reads a top-level `key: value` scalar from a YAML string. Stops at the first
// match. Strips a trailing inline comment. Returns undefined when absent. We use
// this for `variant:` and `initiative_type:` — both flat top-level scalars.
function readYamlScalar(ymlText, key) {
  if (!ymlText) return undefined;
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*(?:#.*)?$`, 'm');
  const m = re.exec(ymlText);
  if (!m) return undefined;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v || undefined;
}

// Detect a `stages.stage_1.requires:` override block (spec step 2 note). Shallow
// detection only — presence flips us to "respect the project's tuning" and emits an
// INFO; we do NOT attempt to parse arbitrary nested requirement lists dep-free.
function hasStage1RequiresOverride(ymlText) {
  if (!ymlText) return false;
  // crude: a `requires:` line nested under a stage_1 region.
  return /stage_1:\s*[\s\S]{0,400}?\brequires:/.test(ymlText);
}

// List immediate files (not dirs) under a directory; empty on any error.
async function listFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

async function listEntries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Is a path a "substantive" file: exists, ≥minBytes, not a scaffold/.gitkeep.
async function isSubstantive(filePath, minBytes) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return false;
    const base = path.basename(filePath).toLowerCase();
    if (base === '.gitkeep' || base === '.keep' || base === 'readme.md') return false;
    if (st.size < minBytes) return false;
    return true;
  } catch {
    return false;
  }
}

// Does a directory contain ≥1 substantive file (recursing one level for grouped
// research, e.g. research/personas/<slug>/file.md)?
async function dirHasSubstantiveFile(dir, minBytes) {
  const entries = await listEntries(dir);
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isFile()) {
      if (await isSubstantive(fp, minBytes)) return true;
    } else if (e.isDirectory()) {
      const sub = await listEntries(fp);
      for (const s of sub) {
        if (s.isFile() && (await isSubstantive(path.join(fp, s.name), minBytes))) return true;
      }
    }
  }
  return false;
}

// ── Persona JTBD extraction (shallow, dep-free) ──────────────────────────────
// A persona declares JTBD either inline (a `jtbd:` block / `--- ... ---`
// frontmatter inside the persona file) or via a sibling jtbd file. We extract the
// JTBD *region* text and report which of the four field KEYS appear with a
// non-empty value. This is presence-scanning, not schema validation — see header.

function extractJtbdRegions(text) {
  // Return an array of region strings that look like JTBD blocks. We capture:
  //  - frontmatter between leading `---` fences (whole block; jtbd keys live there)
  //  - the body following a `jtbd:` line (to the next dedent-to-top-level key or EOF)
  if (!text) return [];
  const regions = [];

  // Frontmatter fence.
  const fm = /^---\s*\n([\s\S]*?)\n---\s*$/m.exec(text);
  if (fm) regions.push(fm[1]);

  // `jtbd:` block(s). Capture lines after a `jtbd:` opener until a line that is a
  // top-level (column-0, non-list) key, which ends the block.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*jtbd:\s*$/.test(lines[i]) || /^\s*-?\s*jtbd:\s*$/.test(lines[i])) {
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^[A-Za-z_]/.test(l) && /:/.test(l)) break; // dedent to a sibling top-level key
        buf.push(l);
      }
      if (buf.length) regions.push(buf.join('\n'));
    }
  }
  // Fallback: if nothing structured matched but the four field keys appear loose in
  // the doc, treat the whole doc as one region (covers plain-Markdown jtbd files).
  if (regions.length === 0) regions.push(text);
  return regions;
}

// Given a region, which JTBD field keys appear with a NON-EMPTY value? Handles
// `key: value`, `key:\n  value`, and a `- key: value` list shape, shallowly.
function presentJtbdFields(regionText) {
  const present = new Set();
  if (!regionText) return present;
  for (const field of JTBD_FIELDS) {
    // key: value-on-same-line (non-empty)
    const inline = new RegExp(`(^|\\n)\\s*-?\\s*${field}:\\s*(\\S.*?)\\s*(?:#.*)?(?=\\n|$)`, 'i');
    const m = inline.exec(regionText);
    if (m && m[2] && m[2].replace(/["']/g, '').trim().length > 0) {
      present.add(field);
      continue;
    }
    // key: then an indented value on the next non-blank line (block scalar / nested)
    const block = new RegExp(`(^|\\n)\\s*-?\\s*${field}:\\s*\\n(\\s+)(\\S.*)`, 'i');
    const b = block.exec(regionText);
    if (b && b[3] && b[3].trim().length > 0) present.add(field);
  }
  return present;
}

// Extract the surface string(s) named by a JTBD region (for funnel coherence).
function surfacesInRegion(regionText) {
  const out = [];
  if (!regionText) return out;
  const re = /(^|\n)\s*-?\s*surface:\s*(\S.*?)\s*(?:#.*)?(?=\n|$)/gi;
  let m;
  while ((m = re.exec(regionText)) !== null) {
    const v = m[2].replace(/["']/g, '').trim();
    if (v) out.push(v);
  }
  return out;
}

// Vague-acceptance heuristic (INFORMATIONAL ONLY — agent-judged per .md step's
// JTBD_ACCEPTANCE_VAGUE note). We flag obvious decoration; the real semantic call
// is the agent's. Never drives a BLOCK.
const VAGUE_ACCEPTANCE = [
  /user is satisfied/i,
  /looks good/i,
  /feels (right|good)/i,
  /\bis happy\b/i,
  /works well/i,
  /good (experience|ux)/i,
];

// Discover persona "units": each top-level persona file plus any per-persona
// subdirectory, paired with the sibling jtbd file(s) if present.
async function discoverPersonas(personasDir) {
  const units = [];
  const entries = await listEntries(personasDir);
  for (const e of entries) {
    const fp = path.join(personasDir, e.name);
    if (e.isFile()) {
      if (!/\.md$/i.test(e.name)) continue;
      if (/\.jtbd\.md$/i.test(e.name)) continue; // sibling, paired below by slug
      const slug = e.name.replace(/\.md$/i, '');
      units.push({ slug, personaFile: fp, dir: personasDir });
    } else if (e.isDirectory()) {
      // research/personas/<slug>/ — persona may live as files inside.
      units.push({ slug: e.name, personaFile: null, dir: fp });
    }
  }
  return units;
}

// Resolve all candidate JTBD source texts for a persona unit (inline + siblings).
async function jtbdSourcesFor(unit, personasDir) {
  const texts = [];
  if (unit.personaFile) {
    const t = await read(unit.personaFile);
    if (t) texts.push(t);
  }
  // Sibling: research/personas/<slug>.jtbd.md
  const flatSibling = path.join(personasDir, `${unit.slug}.jtbd.md`);
  if (await exists(flatSibling)) {
    const t = await read(flatSibling);
    if (t) texts.push(t);
  }
  // Nested: research/personas/<slug>/jtbd.md  (+ any *.md in a persona dir)
  if (unit.dir !== personasDir) {
    for (const name of ['jtbd.md', `${unit.slug}.jtbd.md`]) {
      const nf = path.join(unit.dir, name);
      if (await exists(nf)) {
        const t = await read(nf);
        if (t) texts.push(t);
      }
    }
    // also scan other .md in the persona dir for an inline jtbd block
    for (const f of await listFiles(unit.dir)) {
      if (!/\.md$/i.test(f) || /jtbd\.md$/i.test(f)) continue;
      const t = await read(path.join(unit.dir, f));
      if (t) texts.push(t);
    }
  }
  return texts;
}

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  // ── 1. Resolve variant + initiative_type from blueprint.yml (default greenfield)
  let ymlText = null;
  try {
    ymlText = await read(path.join(artifactsRoot, 'blueprint.yml'));
  } catch {
    ymlText = null;
  }
  // Prefer the parsed object the harness passes; fall back to a scalar scan of raw text.
  const variantRaw =
    (blueprintYml && (blueprintYml.variant || blueprintYml.Variant)) || readYamlScalar(ymlText, 'variant');
  const variant = VARIANT_REQUIREMENTS[variantRaw] ? variantRaw : 'greenfield';
  if (!VARIANT_REQUIREMENTS[variantRaw]) {
    findings.push({
      severity: 'WARN',
      location: 'blueprint.yml',
      message: `variant is ${variantRaw ? `'${variantRaw}' (unrecognized)` : 'absent'} — defaulting to greenfield (all four legs + JTBDs required).`,
      remediation: "Set `variant: greenfield | midstream | brownfield` in blueprint.yml so the gate enforces the right leg set.",
      reference: 'docs/variant-selection.md',
    });
  }
  const initiativeType =
    (blueprintYml && (blueprintYml.initiative_type || blueprintYml.initiativeType)) ||
    readYamlScalar(ymlText, 'initiative_type') ||
    'consumer-app';

  const req = VARIANT_REQUIREMENTS[variant];

  // The research stamper writes a stages.*.requires block by default, so flagging it
  // there is self-generated noise; only note a genuine tuning on the other variants.
  if (variant !== 'research' && hasStage1RequiresOverride(ymlText)) {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml stages.stage_1.requires',
      message:
        'A stages.stage_1.requires: override is present. This reviewer enforces the variant default leg set mechanically; reconciling the override against the table is agent-verified (see .md spec step 2).',
      remediation: 'No action — informational. The agent confirms the override matches intent.',
      reference: 'research-completeness-reviewer.md#what-you-check',
    });
  }

  // ── 2-3. Required research directories: exist AND hold ≥1 substantive file ────
  const populated = [];
  const missing = [];
  for (const rel of req.dirs) {
    const dir = path.join(artifactsRoot, rel);
    if (!(await exists(dir))) {
      missing.push(rel);
      findings.push({
        severity: 'BLOCK',
        location: `${rel}/`,
        message: `Required ${variant} research leg '${rel}/' does not exist.`,
        remediation: `Create ${rel}/ and populate it with substantive research (≥${SUBSTANTIVE_BYTES} bytes of real content, not a .gitkeep).`,
        reference: 'research-completeness-reviewer.md#why-this-gate-exists',
      });
      continue;
    }
    if (!(await dirHasSubstantiveFile(dir, SUBSTANTIVE_BYTES))) {
      missing.push(rel);
      findings.push({
        severity: 'BLOCK',
        location: `${rel}/`,
        message: `Research leg '${rel}/' exists but is empty or scaffold-only (no file ≥${SUBSTANTIVE_BYTES} bytes of non-template content).`,
        remediation: `Populate ${rel}/ with at least one substantive research file. A .gitkeep, an empty stub, or a sub-${SUBSTANTIVE_BYTES}-byte placeholder does not count.`,
        reference: 'research-completeness-reviewer.md#why-this-gate-exists',
      });
      continue;
    }
    populated.push(rel);
  }

  // ── 4-5. Synthesizing artifacts (brownfield: 01-diagnose.md ≥1KB, must cite legs)
  for (const artifact of req.artifacts) {
    const ap = path.join(artifactsRoot, artifact);
    if (!(await isSubstantive(ap, ARTIFACT_BYTES))) {
      findings.push({
        severity: 'BLOCK',
        location: artifact,
        message: `Required ${variant} synthesizing artifact '${artifact}' is absent or <${ARTIFACT_BYTES} bytes.`,
        remediation: `Author ${artifact} (≥1KB) at the initiative root, synthesizing the populated research legs.`,
        reference: 'research-completeness-reviewer.md#what-you-check',
      });
      continue;
    }
    // Brownfield-specific: the diagnose must reference each populated leg by path.
    if (artifact === '01-diagnose.md') {
      const body = (await read(ap)) || '';
      const uncited = populated.filter((leg) => !body.includes(leg) && !body.includes(`${leg}/`));
      if (uncited.length) {
        findings.push({
          severity: 'BLOCK',
          location: artifact,
          message: `01-diagnose.md does not reference populated research leg(s) by path: ${uncited.join(', ')}. A diagnose that doesn't cite its own evidence fails.`,
          remediation: `In 01-diagnose.md, cite each populated leg by path (e.g. "see research/current-state/..."). Uncited: ${uncited.join(', ')}.`,
          reference: 'research-completeness-reviewer.md#what-you-check',
        });
      }
    }
  }

  // ── 6. JTBD-per-persona check (greenfield + brownfield require) ───────────────
  let personasTotal = 0;
  let personasWithJtbd = 0;
  const personasMissingJtbd = [];
  const jtbdFieldsIncomplete = [];
  // persona-slug -> Set of surfaces it declares a JTBD for (for funnel coherence).
  const personaSurfaces = new Map();
  const personasDir = path.join(artifactsRoot, 'research', 'personas');

  if (req.requiresJtbd && (await exists(personasDir))) {
    const units = await discoverPersonas(personasDir);
    personasTotal = units.length;
    for (const unit of units) {
      const texts = await jtbdSourcesFor(unit, personasDir);
      const regions = texts.flatMap((t) => extractJtbdRegions(t));
      // Aggregate field presence across this persona's regions; a persona with
      // multiple surfaces may spread fields across regions, but EACH JTBD entry
      // must name all four. We evaluate per-region and require ≥1 complete region.
      const surfaces = new Set();
      let hasAnyComplete = false;
      const perRegionMissing = [];
      let sawJtbdSignal = false;

      for (const region of regions) {
        const present = presentJtbdFields(region);
        if (present.size > 0) sawJtbdSignal = true;
        for (const s of surfacesInRegion(region)) surfaces.add(s);
        const missingFields = JTBD_FIELDS.filter((f) => !present.has(f));
        if (missingFields.length === 0) {
          hasAnyComplete = true;
        } else if (present.size > 0) {
          perRegionMissing.push(missingFields);
        }

        // INFO-only vague-acceptance heuristic.
        const acc = /(^|\n)\s*-?\s*acceptance:\s*(.+)/i.exec(region);
        if (acc && VAGUE_ACCEPTANCE.some((re) => re.test(acc[2]))) {
          findings.push({
            severity: 'INFO',
            location: `research/personas/${unit.slug}`,
            message: `acceptance: "${acc[2].trim().slice(0, 60)}" reads as vague (JTBD_ACCEPTANCE_VAGUE candidate). Whether it is genuinely untestable is agent-verified (see .md spec).`,
            remediation: 'Replace with a concrete element / measurable count / click depth / time bound (e.g. "Sees 3+ shipped products within 5s").',
            reference: 'research-completeness-reviewer.md#rules',
          });
        }
      }

      personaSurfaces.set(unit.slug, surfaces);

      if (!sawJtbdSignal) {
        personasMissingJtbd.push(unit.slug);
        findings.push({
          severity: 'BLOCK',
          location: `research/personas/${unit.slug}`,
          message: `Persona '${unit.slug}' declares no JTBD — no inline jtbd: block, frontmatter, or sibling .jtbd.md with any of surface/time_budget/job/acceptance.`,
          remediation: `Add a jtbd: block to the persona file (or a sibling research/personas/${unit.slug}.jtbd.md) naming surface, time_budget, job, and acceptance.`,
          reference: 'research-completeness-reviewer.md#what-you-check',
        });
        continue;
      }

      if (hasAnyComplete) {
        personasWithJtbd += 1;
      } else {
        // JTBD signal present but no single entry names all four fields.
        const missingFields = perRegionMissing.length
          ? Array.from(new Set(perRegionMissing.flat()))
          : JTBD_FIELDS.filter((f) => {
              // union of presence across regions
              return !regions.some((r) => presentJtbdFields(r).has(f));
            });
        jtbdFieldsIncomplete.push(`${unit.slug}: missing ${missingFields.join('/')}`);
        findings.push({
          severity: 'BLOCK',
          location: `research/personas/${unit.slug}`,
          message: `Persona '${unit.slug}' JTBD is incomplete — no single entry names all four fields. Missing (field-KEY presence scan): ${missingFields.join(', ')}.`,
          remediation: `Ensure at least one JTBD entry for '${unit.slug}' names a non-empty ${missingFields.join(', ')}. NOTE: this is a dep-free field-KEY presence scan, not deep schema validation — see the .md spec for value-quality.`,
          reference: 'research-completeness-reviewer.md#what-you-check',
        });
      }
    }
  } else if (req.requiresJtbd && !(await exists(personasDir))) {
    // personas leg already flagged BLOCK above (it's in req.dirs for these variants);
    // no separate JTBD finding needed.
  } else if (!req.requiresJtbd) {
    findings.push({
      severity: 'INFO',
      location: 'research/personas/',
      message: `Variant '${variant}' requires JTBD only for personas the scoped change affects — which personas are in scope is agent-verified (see .md spec step 6). Mechanical per-persona JTBD enforcement skipped.`,
      remediation: 'No action — informational.',
      reference: 'research-completeness-reviewer.md#what-you-check',
    });
  }

  // ── 7. Funnel ↔ persona ↔ JTBD coherence ─────────────────────────────────────
  // Extract persona/surface pairs referenced in research/funnel/, then verify each
  // pair has a matching JTBD entry. Missing → BLOCK. Pairs are matched leniently:
  // we look for a known persona slug AND a surface token co-occurring on a funnel
  // line. Surface extraction is heuristic — flagged INFO so the agent knows the
  // mechanical matcher's limits.
  const funnelDir = path.join(artifactsRoot, 'research', 'funnel');
  const funnelSurfacesWithoutJtbd = [];
  if (req.requiresJtbd && (await exists(funnelDir)) && personaSurfaces.size > 0) {
    const funnelFiles = [];
    for (const e of await listEntries(funnelDir)) {
      if (e.isFile() && /\.(md|ya?ml|txt)$/i.test(e.name)) funnelFiles.push(path.join(funnelDir, e.name));
    }
    const knownSlugs = Array.from(personaSurfaces.keys());
    let matchedAnyPair = false;

    for (const ff of funnelFiles) {
      const text = (await read(ff)) || '';
      const lines = text.split('\n');
      for (const slug of knownSlugs) {
        // does the funnel mention this persona at all?
        const slugRe = new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (!slugRe.test(text)) continue;
        const declared = personaSurfaces.get(slug) || new Set();
        // find surfaces named on lines that also reference the persona, OR explicit
        // `surface:` lines anywhere in the funnel.
        const funnelSurfaces = new Set();
        for (const l of lines) {
          const sm = /surface:\s*(\S.*?)\s*(?:#.*)?$/i.exec(l);
          if (sm) {
            const v = sm[1].replace(/["']/g, '').trim();
            if (v) funnelSurfaces.add(v);
          }
        }
        for (const surf of funnelSurfaces) {
          matchedAnyPair = true;
          const hasMatch = Array.from(declared).some((d) => d === surf || d.includes(surf) || surf.includes(d));
          if (!hasMatch) {
            const pair = `${slug} @ ${surf}`;
            if (!funnelSurfacesWithoutJtbd.includes(pair)) {
              funnelSurfacesWithoutJtbd.push(pair);
              findings.push({
                severity: 'BLOCK',
                location: `research/funnel/ → research/personas/${slug}`,
                message: `Funnel names persona/surface pair '${pair}' but persona '${slug}' has no JTBD entry for surface '${surf}'.`,
                remediation: `Add a JTBD entry to persona '${slug}' for surface '${surf}', or fix the funnel if the surface is stale.`,
                reference: 'research-completeness-reviewer.md#what-you-check',
              });
            }
          }
        }
      }
    }
    findings.push({
      severity: 'INFO',
      location: 'research/funnel/',
      message: matchedAnyPair
        ? "Funnel↔persona↔JTBD coherence checked by mechanical reference-matching (persona slug + `surface:` co-occurrence). Pairs expressed only in prose are agent-verified (see .md spec step 7)."
        : "No structured `surface:` persona/funnel pairs were mechanically extractable from research/funnel/. Funnel coherence for prose-only funnels is agent-verified (see .md spec step 7).",
      remediation: 'No action — informational. For full coverage, express funnel pairs as `surface:` entries the matcher can read.',
      reference: 'research-completeness-reviewer.md#what-you-check',
    });

    // PERSONA_OUT_OF_FUNNEL (warning): a persona never referenced by any funnel file.
    const funnelText = (await Promise.all(funnelFiles.map(read))).filter(Boolean).join('\n');
    for (const slug of knownSlugs) {
      const slugRe = new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (!slugRe.test(funnelText)) {
        findings.push({
          severity: 'WARN',
          location: `research/personas/${slug}`,
          message: `PERSONA_OUT_OF_FUNNEL: persona '${slug}' is not referenced by any file in research/funnel/.`,
          remediation: `Add '${slug}' to the funnel, or confirm the persona is intentionally out of scope.`,
          reference: 'research-completeness-reviewer.md#what-you-check',
        });
      }
    }
  }

  // ── 8. Architect-challenge check (platform-feature only) ─────────────────────
  let architectStatus = 'skipped';
  if (initiativeType === 'platform-feature') {
    const csDir = path.join(artifactsRoot, 'research', 'current-state');
    const primary = path.join(csDir, 'architectural-options.md');
    let optionsFile = null;
    let body = '';

    if (await isSubstantive(primary, ARTIFACT_BYTES)) {
      optionsFile = primary;
      body = (await read(primary)) || '';
    } else {
      // Accept a sibling under research/current-state/ whose body addresses the
      // five dimensions (.md spec step 8 location-convention note).
      for (const f of await listFiles(csDir)) {
        if (!/\.md$/i.test(f)) continue;
        const fp = path.join(csDir, f);
        if (!(await isSubstantive(fp, ARTIFACT_BYTES))) continue;
        const t = (await read(fp)) || '';
        const hits = ARCHITECT_DIMENSIONS.filter((d) => d.re.test(t)).length;
        if (hits >= 3) {
          optionsFile = fp;
          body = t;
          break;
        }
      }
    }

    if (!optionsFile) {
      architectStatus = 'MISSING';
      findings.push({
        severity: 'BLOCK',
        location: 'research/current-state/architectural-options.md',
        message: 'ARCHITECT_CHALLENGE_MISSING: no architectural-options.md (≥1KB) — and no sibling under research/current-state/ addressing the five dimensions. A platform-feature initiative must run the architect challenge before Stage 2.',
        remediation: 'Author research/current-state/architectural-options.md comparing options across Expression, Validation, Authoring, Escape hatch, and Evaluation cost, with an explicit choice + source citations.',
        reference: 'template/docs/methodology/architect-challenge-pattern.md',
      });
    } else {
      const missingDims = ARCHITECT_DIMENSIONS.filter((d) => !d.re.test(body)).map((d) => d.key);
      if (missingDims.length) {
        architectStatus = 'INCOMPLETE';
        findings.push({
          severity: 'BLOCK',
          location: path.relative(targetDir, optionsFile),
          message: `ARCHITECT_CHALLENGE_INCOMPLETE: missing dimension header(s): ${missingDims.join(', ')}. All five are required.`,
          remediation: `Add a section addressing each missing dimension: ${missingDims.join(', ')}.`,
          reference: 'template/docs/methodology/architect-challenge-pattern.md',
        });
      }

      // Explicit-choice grep: "we choose" / "option X" / typed-condition heuristic.
      const hasChoice =
        /we\s+choose/i.test(body) ||
        /\bchosen\b/i.test(body) ||
        /\boption\s+[a-z0-9]\b/i.test(body) ||
        /typed[- ]condition\s+wins\s+ties/i.test(body);
      if (!hasChoice) {
        architectStatus = architectStatus === 'INCOMPLETE' ? architectStatus : 'NO_ARGUMENT';
        findings.push({
          severity: 'BLOCK',
          location: path.relative(targetDir, optionsFile),
          message: 'ARCHITECT_CHALLENGE_NO_ARGUMENT: comparison present but no explicit choice language ("we choose", "option X", or the "typed-condition wins ties" heuristic). Silence is not acceptable.',
          remediation: 'State the choice explicitly: "we choose option X for reasons A, B, C" — or invoke the typed-condition-wins-ties heuristic from the pattern doc.',
          reference: 'template/docs/methodology/architect-challenge-pattern.md',
        });
      } else {
        // Choice language found, but whether the PROSE is a genuine reasoned choice
        // (not just the words) is agent-judged.
        findings.push({
          severity: 'INFO',
          location: path.relative(targetDir, optionsFile),
          message: 'Explicit-choice language found by grep. Whether the surrounding prose is a genuine reasoned architectural argument is agent-verified (see .md spec step 8).',
          remediation: 'No action — informational.',
          reference: 'research-completeness-reviewer.md#what-you-check',
        });
      }

      // Source-citation grep: "Source:" / a vendor docs.<domain> URL / an internal doc path.
      const hasCitation =
        /source:/i.test(body) ||
        /docs\.[a-z][a-z0-9-]*\.[a-z]{2,}/i.test(body) ||
        /\bdocs\/[\w./-]+\.md\b/i.test(body) ||
        /https?:\/\//i.test(body);
      if (!hasCitation) {
        architectStatus = ['MISSING', 'INCOMPLETE'].includes(architectStatus) ? architectStatus : 'UNCITED';
        findings.push({
          severity: 'BLOCK',
          location: path.relative(targetDir, optionsFile),
          message: 'ARCHITECT_CHALLENGE_UNCITED: platform-capability claims lack source citations ("Source:", a vendor docs URL, or an internal doc path). The "what needs to be true" prerequisite is silent.',
          remediation: 'Cite confirmed platform capabilities the comparison depends on with explicit Source: markers (vendor docs URL or internal doc path).',
          reference: 'template/docs/methodology/current-state-research-prompt.md',
        });
      }

      if (architectStatus === 'skipped') architectStatus = missingDims.length || !hasChoice || !hasCitation ? architectStatus : 'pass';
    }
  } else {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml initiative_type',
      message: `initiative_type is '${initiativeType}' (not platform-feature) — architect-challenge check skipped per .md spec step 8.`,
      remediation: 'No action — informational.',
      reference: 'research-completeness-reviewer.md#what-you-check',
    });
  }

  const summary =
    `variant=${variant} type=${initiativeType}; legs ${populated.length}/${req.dirs.length} populated` +
    (req.requiresJtbd ? `; personas ${personasWithJtbd}/${personasTotal} with JTBD` : '') +
    (initiativeType === 'platform-feature' ? `; architect=${architectStatus}` : '') +
    (missing.length ? `; MISSING ${missing.join(',')}` : '');

  return finalize(findings, summary, startedAt);
}

// ── Self-test (node research-completeness-reviewer.mjs) ───────────────────────
// Builds inline fixtures under a temp dir, runs the reviewer, asserts the verdict.
// Exits non-zero on any failed assertion (matches the libs' self-test pattern).
if (import.meta.url === `file://${process.argv[1]}`) {
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };
  let assertions = 0;
  const ok = (cond, msg) => {
    assertions += 1;
    assert(cond, msg);
  };

  const filler = (label) => `# ${label}\n` + 'lorem ipsum dolor sit amet, '.repeat(40) + '\nend.\n';

  async function mkInitiative(spec) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rcr-'));
    if (spec.yml != null) await fs.writeFile(path.join(dir, 'blueprint.yml'), spec.yml);
    for (const [rel, content] of Object.entries(spec.files || {})) {
      const fp = path.join(dir, rel);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, content);
    }
    return dir;
  }

  // 1. Greenfield, all four legs missing → BLOCKED, 4 leg BLOCKs.
  {
    const dir = await mkInitiative({ yml: 'variant: greenfield\n' });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield' } });
    ok(r.status === 'BLOCKED', '1: empty greenfield blocks');
    const legBlocks = r.findings.filter((f) => f.severity === 'BLOCK' && /research leg/i.test(f.message));
    ok(legBlocks.length === 4, `1: all four legs flagged (got ${legBlocks.length})`);
    ok(r.metadata.reviewer === NAME, '1: reviewer name in metadata');
  }

  // 2. Greenfield fully populated + complete persona JTBD + matching funnel → PASS.
  {
    const persona = `---
name: shopper
jtbd:
  surface: /products
  time_budget: 5 seconds
  job: Verify the catalog is real
  acceptance: Sees 3+ named products with live URLs within 5 seconds
---
${filler('Shopper persona')}`;
    const dir = await mkInitiative({
      yml: 'variant: greenfield\ninitiative_type: consumer-app\n',
      files: {
        'research/current-state/state.md': filler('current state'),
        'research/competitive/comp.md': filler('competitive'),
        'research/personas/shopper.md': persona,
        'research/funnel/funnel.md': `# Funnel\nshopper enters at\nsurface: /products\n${filler('funnel')}`,
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield', initiative_type: 'consumer-app' } });
    const blocks = r.findings.filter((f) => f.severity === 'BLOCK');
    ok(blocks.length === 0, `2: fully populated greenfield has no BLOCK (got ${blocks.map((b) => b.message).join(' | ')})`);
    ok(r.status === 'PASS' || r.status === 'WARN', `2: status not BLOCKED (got ${r.status})`);
  }

  // 3. Persona present but JTBD missing the `acceptance` field → BLOCKED with field call-out.
  {
    const persona = `---
name: lead
jtbd:
  surface: /
  time_budget: 90 seconds
  job: Decide whether to book
---
${filler('Lead persona')}`;
    const dir = await mkInitiative({
      yml: 'variant: greenfield\n',
      files: {
        'research/current-state/state.md': filler('cs'),
        'research/competitive/comp.md': filler('comp'),
        'research/personas/lead.md': persona,
        'research/funnel/funnel.md': filler('funnel'),
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield' } });
    ok(r.status === 'BLOCKED', '3: incomplete JTBD blocks');
    const jtbdBlock = r.findings.find((f) => f.severity === 'BLOCK' && /JTBD is incomplete/i.test(f.message));
    ok(jtbdBlock && /acceptance/i.test(jtbdBlock.message), '3: missing acceptance field named');
  }

  // 4. Empty (scaffold-only) leg → BLOCKED. .gitkeep + sub-500-byte stub don't count.
  {
    const dir = await mkInitiative({
      yml: 'variant: greenfield\n',
      files: {
        'research/current-state/.gitkeep': '',
        'research/current-state/stub.md': 'tiny',
        'research/competitive/comp.md': filler('comp'),
        'research/personas/p.md': `---\njtbd:\n  surface: /\n  time_budget: 5s\n  job: do it\n  acceptance: sees 3 things in 5s\n---\n${filler('p')}`,
        'research/funnel/funnel.md': filler('funnel'),
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield' } });
    ok(r.status === 'BLOCKED', '4: scaffold-only leg blocks');
    const empty = r.findings.find((f) => f.severity === 'BLOCK' && /empty or scaffold-only/i.test(f.message) && /current-state/.test(f.location));
    ok(!!empty, '4: current-state flagged empty/scaffold');
  }

  // 5. Brownfield missing 01-diagnose.md → BLOCKED on the artifact.
  {
    const dir = await mkInitiative({
      yml: 'variant: brownfield\n',
      files: {
        'research/current-state/state.md': filler('cs'),
        'research/competitive/comp.md': filler('comp'),
        'research/personas/p.md': `---\njtbd:\n  surface: /\n  time_budget: 5s\n  job: do it\n  acceptance: sees 3 in 5s\n---\n${filler('p')}`,
        'research/funnel/funnel.md': filler('funnel'),
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'brownfield' } });
    const diag = r.findings.find((f) => f.severity === 'BLOCK' && /01-diagnose\.md/.test(f.location));
    ok(!!diag, '5: brownfield missing diagnose flagged');
  }

  // 6. platform-feature with a complete architectural-options.md → no architect BLOCK.
  {
    const opts =
      `# Architectural options\n` +
      `## Expression surface\nWhat each option can express...\n` +
      `## Validation surface\nStatic vs runtime validation...\n` +
      `## Authoring surface\nThe merchant UI...\n` +
      `## Escape hatch\nMigration path...\n` +
      `## Evaluation cost\np95 latency at the call site...\n` +
      `## Decision\nWe choose option B for reasons A, B, C.\n` +
      `Source: https://docs.example-vendor.com/some-capability\n` +
      'padding '.repeat(160);
    const dir = await mkInitiative({
      yml: 'variant: greenfield\ninitiative_type: platform-feature\n',
      files: {
        'research/current-state/architectural-options.md': opts,
        'research/competitive/comp.md': filler('comp'),
        'research/personas/p.md': `---\njtbd:\n  surface: /\n  time_budget: 5s\n  job: do it\n  acceptance: sees 3 in 5s\n---\n${filler('p')}`,
        'research/funnel/funnel.md': `surface: /\n${filler('funnel')}`,
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield', initiative_type: 'platform-feature' } });
    const archBlocks = r.findings.filter((f) => f.severity === 'BLOCK' && /ARCHITECT_CHALLENGE/.test(f.message));
    ok(archBlocks.length === 0, `6: complete architect doc has no ARCHITECT BLOCK (got ${archBlocks.map((b) => b.message).join(' | ')})`);
  }

  // 7. platform-feature missing the architect doc → ARCHITECT_CHALLENGE_MISSING BLOCK.
  {
    const dir = await mkInitiative({
      yml: 'variant: greenfield\ninitiative_type: platform-feature\n',
      files: {
        'research/current-state/state.md': filler('cs'),
        'research/competitive/comp.md': filler('comp'),
        'research/personas/p.md': `---\njtbd:\n  surface: /\n  time_budget: 5s\n  job: do it\n  acceptance: sees 3 in 5s\n---\n${filler('p')}`,
        'research/funnel/funnel.md': `surface: /\n${filler('funnel')}`,
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield', initiative_type: 'platform-feature' } });
    const miss = r.findings.find((f) => f.severity === 'BLOCK' && /ARCHITECT_CHALLENGE_MISSING/.test(f.message));
    ok(!!miss, '7: missing architect doc flagged');
  }

  // 8. consumer-app never gets an architect BLOCK; judgment criteria stay INFO.
  {
    const dir = await mkInitiative({
      yml: 'variant: greenfield\n',
      files: {
        'research/current-state/state.md': filler('cs'),
        'research/competitive/comp.md': filler('comp'),
        'research/personas/p.md': `---\njtbd:\n  surface: /\n  time_budget: 5s\n  job: do it\n  acceptance: user is satisfied\n---\n${filler('p')}`,
        'research/funnel/funnel.md': `surface: /\n${filler('funnel')}`,
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield' } });
    ok(!r.findings.some((f) => /ARCHITECT_CHALLENGE/.test(f.message) && f.severity === 'BLOCK'), '8: consumer-app no architect block');
    const vague = r.findings.find((f) => f.severity === 'INFO' && /JTBD_ACCEPTANCE_VAGUE/.test(f.message));
    ok(!!vague, '8: vague acceptance emitted as INFO, not BLOCK');
    ok(!r.findings.some((f) => f.severity === 'BLOCK' && /acceptance/i.test(f.message) && /vague/i.test(f.message)), '8: vague acceptance never a BLOCK');
  }

  // 9. Sibling .jtbd.md file is recognized (persona file itself has no jtbd).
  {
    const dir = await mkInitiative({
      yml: 'variant: greenfield\n',
      files: {
        'research/current-state/state.md': filler('cs'),
        'research/competitive/comp.md': filler('comp'),
        'research/personas/buyer.md': filler('buyer persona prose only'),
        'research/personas/buyer.jtbd.md': `surface: /cart\ntime_budget: 30 seconds\njob: Complete checkout\nacceptance: Reaches confirmation in <=3 clicks within 30s\n`,
        'research/funnel/funnel.md': `surface: /cart\n${filler('funnel')}`,
      },
    });
    const r = await review({ targetDir: dir, blueprintYml: { variant: 'greenfield' } });
    ok(!r.findings.some((f) => f.severity === 'BLOCK' && /buyer/.test(f.location || '')), '9: sibling .jtbd.md satisfies the persona');
  }

  // 10. Never throws on a totally absent targetDir / no blueprint.yml → defaults greenfield, blocks.
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rcr-bare-'));
    const r = await review({ targetDir: dir, blueprintYml: undefined });
    ok(r.status === 'BLOCKED', '10: bare dir defaults to greenfield and blocks on missing legs');
    ok(r.findings.some((f) => f.severity === 'WARN' && /defaulting to greenfield/.test(f.message)), '10: variant-default WARN emitted');
  }

  console.log(`research-completeness-reviewer self-test: PASS (${assertions} assertions)`);
}
