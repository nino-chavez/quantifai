/**
 * prescription-jtbd-traceability-reviewer.mjs — executable pair for the paired
 * .md spec. The Stage 2 → Stage 3 JTBD-trace gate for brownfield + midstream
 * initiatives (ADR-0004). Implements the ADR-0002 reviewer contract so the gate
 * runs in CI / CLI / any node, outside Claude Code:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (ADR-0004 — prevent JTBD discontinuity between the Stage 1 funnel and
 * the Stage 3 brief):
 *   - variant greenfield → PASS (out of scope; greenfield uses design-principles-reviewer).
 *   - prescription file missing → BLOCK (PRESCRIPTION_MISSING).
 *   - no JTBD index can be built (personas have no jtbd: blocks) → BLOCK (STAGE_1_INCOMPLETE).
 *   - a prescription item with no serves_jtbd: field → BLOCK (PRESCRIPTION_ITEM_UNANCHORED).
 *   - serves_jtbd: <ref> that doesn't resolve to the index → BLOCK (BROKEN_JTBD_REF).
 *   - serves_jtbd: none-deferred with no serves_jtbd_reason (or < 10 words) → BLOCK.
 *   - a JTBD entry missing any of {surface,time_budget,job,acceptance} → BLOCK (JTBD_INCOMPLETE_UPSTREAM).
 *   - a JTBD in the index with no serving item and no deferral → WARN (JTBD_UNADDRESSED).
 *
 * MECHANICAL SCOPE / HONEST LIMITS. This is a HYBRID reviewer. The mechanical
 * checks below are real. Two spec criteria need agent judgment and are NOT faked
 * here — they emit an informational `agent-verified` finding and never drive
 * BLOCKED:
 *   - Whether a `serves_jtbd_reason` is *substantive* (legitimate infra-only
 *     deferral) vs scope-creep cover text. We mechanically enforce the ≥10-word
 *     floor and the "scope creep" / "out of scope" blacklist; the substance call
 *     is the agent's (see .md § Rules).
 *   - Wedge ↔ JTBD coherence (spec step 7). Requires reading whether the JTBDs a
 *     wedge's items serve are semantically aligned with the wedge's stated intent.
 *
 * PARSING NOTE (dep-free): persona files are Markdown + YAML frontmatter, or carry
 * a sibling `<slug>.jtbd.md` / `<slug>/jtbd.md`. There is no YAML dep. We hand-parse
 * via line-scan — split frontmatter on `---` delimiters, then a shallow indent-aware
 * scan of the `jtbd:` block and the prescription `items:` list. Both are scoped to
 * field PRESENCE + scalar capture, not deep schema validation; findings say so.
 *
 * REUSE NOTE: the spec asked to reuse cost-dial.mjs's `parseInlineMap` for `{ k: v }`
 * inline maps. That function is INTERNAL to cost-dial.mjs — it is not exported (only
 * ANCHORS/DEFAULT/effortRank/modelRank/parse-/read-/resolveCost/underProcessed are).
 * Rather than widen that shared lib's public surface (methodology source, own
 * self-test), `parseInlineMap` + its comma/quote helpers are reproduced locally here,
 * faithful to the original. If cost-dial.mjs later exports it, swap to the import.
 *
 * Reference: docs/decisions/0004-jtbd-continuity-and-forge-provenance.md.
 * Dependency-free node ESM. Never throws — risky reads degrade to a finding.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'prescription-jtbd-traceability-reviewer';

// ── Local copy of cost-dial.mjs's internal inline-map parser (see REUSE NOTE) ──
// Splits commas that are NOT inside a quoted string, then `key: value` per piece.
function splitTopLevelCommas(s) {
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
  const out = {};
  for (const piece of splitTopLevelCommas(braced)) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(piece);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);
const exists = (p) => fs.access(p).then(() => true, () => false);

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

// ── kebab-case the first 5 words of a job: field → <job-slug> (spec step 3) ──
export function jobSlug(jobText) {
  return String(jobText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
}

// ── Shallow indent-aware block parser ────────────────────────────────────────
// Given the full text and a starting line index whose content is `key:`, return
// the list of immediate child key→value scalars (and nested block bodies as raw
// text) until the indentation dedents back to the parent's level or shallower.
// Hand-parser, line-scan only — matches cost-dial.mjs's shape. No deep validation.

function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  return m ? m[1].replace(/\t/g, '  ').length : 0;
}

function stripComment(s) {
  // Cut a trailing ` # comment` not inside quotes (mirrors cost-dial.stripScalarComment).
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Split a Markdown persona file into { frontmatter, body }. Frontmatter is the
 * text between a leading `---` line and the next `---`. If absent, frontmatter is
 * '' and the whole file is the body (JTBD may live in a fenced yaml block there,
 * but the spec's canonical shape is frontmatter or a sibling jtbd file).
 */
export function splitFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: '', body: text };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { frontmatter: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    }
  }
  return { frontmatter: '', body: text }; // no closing delimiter → treat as no frontmatter
}

/**
 * Parse a `jtbd:` block out of YAML-ish text into an array of entries. Two shapes
 * are accepted (both shallow, line-scanned):
 *
 *   jtbd:
 *     - surface: hero
 *       time_budget: 5s
 *       job: see 3+ named shipped products
 *       acceptance: 3+ product links visible
 *       disposition: deferred-to-next-round   # optional
 *
 *   jtbd:
 *     hero: { surface: hero, time_budget: 5s, job: ..., acceptance: ... }   # inline map
 *
 * Returns [{ surface, time_budget, job, acceptance, disposition? }, ...]. Missing
 * fields are simply absent on the object (presence is checked by the caller).
 */
export function parseJtbdBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^(\s*)jtbd:\s*(#.*)?$/.test(l));
  if (start < 0) return [];
  const baseIndent = indentOf(lines[start]);
  const entries = [];
  let cur = null;

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    const ind = indentOf(raw);
    if (ind <= baseIndent) break; // dedented out of the jtbd: block

    const content = stripComment(raw).trim();

    // List-item start: `- key: value` (begins a new entry).
    const li = /^-\s*(.*)$/.exec(content);
    if (li) {
      if (cur) entries.push(cur);
      cur = {};
      const rest = li[1].trim();
      // inline map on the dash line: `- { surface: ..., job: ... }`
      const inline = /^\{(.*)\}$/.exec(rest);
      if (inline) {
        Object.assign(cur, parseInlineMap(inline[1]));
        entries.push(cur);
        cur = null;
        continue;
      }
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(rest);
      if (kv) cur[kv[1]] = unquote(kv[2]);
      continue;
    }

    // `slug: { surface: ..., ... }` inline-map entry (keyed-map shape).
    const keyedInline = /^([A-Za-z_][\w./-]*)\s*:\s*\{(.*)\}\s*$/.exec(content);
    if (keyedInline) {
      if (cur) { entries.push(cur); cur = null; }
      entries.push(parseInlineMap(keyedInline[2]));
      continue;
    }

    // Plain `key: value` continuation of the current list-item entry.
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(content);
    if (kv && cur) cur[kv[1]] = unquote(kv[2]);
  }
  if (cur) entries.push(cur);
  return entries;
}

/**
 * Parse the prescription `items:` list into an array of item objects. Shallow,
 * line-scanned. Recognizes `id:`, `serves_jtbd:` (inline `[a, b]` list OR a
 * `none-deferred` scalar OR a block list of `- ref`), and `serves_jtbd_reason:`.
 * Other fields are captured opaquely. Presence/shape is checked by the caller.
 */
export function parsePrescriptionItems(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^(\s*)items:\s*(#.*)?$/.test(l));
  if (start < 0) return [];
  const baseIndent = indentOf(lines[start]);
  const items = [];
  let cur = null;
  let pendingListKey = null; // when serves_jtbd: is a multi-line block list
  let pendingListIndent = -1;

  const finishPending = () => { pendingListKey = null; pendingListIndent = -1; };

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    const ind = indentOf(raw);
    if (ind <= baseIndent) break; // out of items: block
    const content = stripComment(raw).trim();

    // A block-list continuation `- ref` under a pending `serves_jtbd:` key.
    if (pendingListKey && /^-\s+/.test(content) && ind > pendingListIndent) {
      const v = unquote(content.replace(/^-\s+/, ''));
      if (cur) {
        if (!Array.isArray(cur[pendingListKey])) cur[pendingListKey] = [];
        cur[pendingListKey].push(v);
      }
      continue;
    }
    finishPending();

    const li = /^-\s*(.*)$/.exec(content);
    if (li) {
      if (cur) items.push(cur);
      cur = {};
      const rest = li[1].trim();
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(rest);
      if (kv) assignItemField(cur, kv[1], kv[2], (k, ind2) => { pendingListKey = k; pendingListIndent = ind2; }, ind);
      continue;
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(content);
    if (kv && cur) assignItemField(cur, kv[1], kv[2], (k) => { pendingListKey = k; pendingListIndent = ind; }, ind);
  }
  if (cur) items.push(cur);
  return items;
}

function assignItemField(item, key, rawVal, setPendingList, ind) {
  const val = rawVal.trim();
  if (key === 'serves_jtbd') {
    const inlineList = /^\[(.*)\]$/.exec(val);
    if (inlineList) {
      item.serves_jtbd = inlineList[1]
        .split(',')
        .map((s) => unquote(s))
        .filter(Boolean);
    } else if (val === '' ) {
      // value on following lines as a block list
      item.serves_jtbd = [];
      setPendingList('serves_jtbd', ind);
    } else {
      item.serves_jtbd = unquote(val); // e.g. none-deferred (scalar)
    }
    return;
  }
  item[key] = unquote(val);
}

// ── blueprint.yml shallow scalar reads (no yaml dep) ─────────────────────────
function topScalar(ymlText, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = re.exec(ymlText || '');
  return m ? unquote(stripComment(m[1]).trim()) : null;
}

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // ── 1. Variant gate ────────────────────────────────────────────────────────
  let variant = blueprintYml && (blueprintYml.variant || blueprintYml.Variant);
  if (!variant) {
    const ymlText = await read(path.join(targetDir, 'blueprint.yml'));
    if (ymlText == null) {
      findings.push({
        severity: 'BLOCK',
        location: 'blueprint.yml',
        message: 'Cannot read blueprint.yml — variant is undeterminable, so the JTBD-trace gate cannot scope itself.',
        remediation: 'Ensure blueprint.yml exists at the initiative root with a `variant:` field (greenfield | midstream | brownfield).',
        reference: 'docs/variant-selection.md',
      });
      return finalize(findings, 'blueprint.yml unreadable', startedAt);
    }
    variant = topScalar(ymlText, 'variant');
  }
  variant = (variant || '').toLowerCase();

  if (variant === 'greenfield') {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml variant',
      message: 'OUT_OF_SCOPE_FOR_VARIANT: greenfield uses design-principles-reviewer for the Stage 2 → 3 gate; greenfield JTBD-trace is deferred per ADR-0004 follow-up.',
      remediation: 'No action. If this initiative is positioning-shaped and not functional, consider the ADR-0004 follow-up that adds JTBD-trace to design-principles-reviewer.',
      reference: 'docs/decisions/0004-jtbd-continuity-and-forge-provenance.md',
    });
    return result('PASS', findings, 'greenfield — out of scope (design-principles-reviewer)', startedAt);
  }
  if (variant !== 'brownfield' && variant !== 'midstream') {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml variant',
      message: `Variant '${variant || '(none)'}' is not brownfield or midstream — this gate only runs for those two. Treating as out of scope.`,
      remediation: 'Confirm the variant in blueprint.yml. greenfield → design-principles-reviewer; midstream/brownfield → this reviewer + prescription-evidence-reviewer.',
      reference: 'docs/variant-selection.md',
    });
    return result('PASS', findings, `variant '${variant || 'unknown'}' — out of scope`, startedAt);
  }

  // ── 2. Locate the prescription artifact ────────────────────────────────────
  const candidates = ['02-prescription.yml', 'prescription.yml'];
  let prescriptionPath = null;
  let prescriptionText = null;
  for (const c of candidates) {
    const p = path.join(targetDir, c);
    if (await exists(p)) {
      prescriptionPath = p;
      prescriptionText = await read(p);
      break;
    }
  }
  if (!prescriptionPath) {
    findings.push({
      severity: 'BLOCK',
      location: targetDir,
      message: `PRESCRIPTION_MISSING: neither 02-prescription.yml (brownfield) nor prescription.yml (midstream) found at the initiative root.`,
      remediation: 'Author the Stage 2 prescription before requesting the Stage 2 → 3 gate. Brownfield writes 02-prescription.yml; midstream writes prescription.yml.',
      reference: 'prescription-jtbd-traceability-reviewer.md#what-you-check',
    });
    return finalize(findings, 'prescription missing', startedAt);
  }
  if (prescriptionText == null) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionPath,
      message: 'Prescription file present but unreadable.',
      remediation: 'Check file permissions / encoding on the prescription file.',
      reference: 'prescription-jtbd-traceability-reviewer.md',
    });
    return finalize(findings, 'prescription unreadable', startedAt);
  }

  // ── 3. Build the JTBD index from research/personas/ ────────────────────────
  // index: Map<"persona/surface/job-slug", { surface, time_budget, job, acceptance, disposition?, persona, _incomplete:[] }>
  const personasDir = path.join(targetDir, 'research', 'personas');
  const jtbdIndex = new Map();
  const incompleteJtbds = []; // entries missing one of the 4 required fields
  let personaCount = 0;
  let personasWithJtbd = 0;

  let personaEntries = [];
  try {
    personaEntries = await fs.readdir(personasDir, { withFileTypes: true });
  } catch {
    personaEntries = [];
  }

  // Collect (personaSlug, jtbdSourceText) pairs. A persona's JTBD can be inline in
  // its .md frontmatter, or in a sibling <slug>.jtbd.md / <slug>/jtbd.md.
  const REQUIRED = ['surface', 'time_budget', 'job', 'acceptance'];

  async function ingestPersona(personaSlug, sourceText) {
    const fm = splitFrontmatter(sourceText);
    // Try frontmatter first, then the whole file (covers sibling .jtbd.md without frontmatter).
    let entries = parseJtbdBlock(fm.frontmatter);
    if (entries.length === 0) entries = parseJtbdBlock(sourceText);
    if (entries.length === 0) return false;
    personasWithJtbd += 1;
    for (const e of entries) {
      const missing = REQUIRED.filter((k) => !e[k] || String(e[k]).trim() === '');
      const surface = e.surface ? String(e.surface).trim() : 'UNKNOWN_SURFACE';
      const slug = e.job ? jobSlug(e.job) : 'unknown-job';
      const key = `${personaSlug}/${surface}/${slug}`;
      const rec = { ...e, persona: personaSlug, _missing: missing };
      jtbdIndex.set(key, rec);
      if (missing.length) incompleteJtbds.push({ key, missing });
    }
    return true;
  }

  for (const ent of personaEntries) {
    const full = path.join(personasDir, ent.name);
    if (ent.isDirectory()) {
      // sibling jtbd.md inside a per-persona dir
      const personaSlug = ent.name;
      const sibling = path.join(full, 'jtbd.md');
      const personaMd = path.join(full, `${personaSlug}.md`);
      const indexMd = path.join(full, 'index.md');
      let txt = null;
      for (const p of [sibling, personaMd, indexMd]) {
        if (await exists(p)) { txt = await read(p); if (txt) break; }
      }
      if (txt != null) {
        personaCount += 1;
        await ingestPersona(personaSlug, txt);
      }
      continue;
    }
    if (!/\.md$/.test(ent.name)) continue;
    // A `<slug>.jtbd.md` sibling — attribute to <slug>; a plain `<slug>.md` — persona file.
    const jtbdSibling = /^(.*)\.jtbd\.md$/.exec(ent.name);
    const personaSlug = jtbdSibling ? jtbdSibling[1] : ent.name.replace(/\.md$/, '');
    const txt = await read(full);
    if (txt == null) continue;
    personaCount += 1;
    await ingestPersona(personaSlug, txt);
  }

  // STAGE_1_INCOMPLETE: no JTBD index could be built at all.
  if (jtbdIndex.size === 0) {
    findings.push({
      severity: 'BLOCK',
      location: personasDir,
      message: personaCount === 0
        ? `STAGE_1_INCOMPLETE: research/personas/ has no persona files — no JTBD index can be built. The Stage 1 → 2 gate (research-completeness-reviewer) should have caught this.`
        : `STAGE_1_INCOMPLETE: ${personaCount} persona file(s) found but none carry a jtbd: block (inline frontmatter or sibling <slug>.jtbd.md). No JTBD index can be built.`,
      remediation: 'Add a jtbd: block to each persona with surface/time_budget/job/acceptance per the funnel. See ADR-0004 § Decision step 1.',
      reference: 'docs/decisions/0004-jtbd-continuity-and-forge-provenance.md',
    });
    return finalize(findings, 'STAGE_1_INCOMPLETE — empty JTBD index', startedAt);
  }

  // JTBD_INCOMPLETE_UPSTREAM: any indexed JTBD missing one of the 4 required fields.
  if (incompleteJtbds.length) {
    for (const { key, missing } of incompleteJtbds) {
      findings.push({
        severity: 'BLOCK',
        location: `research/personas/ → ${key}`,
        message: `JTBD_INCOMPLETE_UPSTREAM: JTBD '${key}' is missing required field(s): ${missing.join(', ')}. (Mechanical: field PRESENCE only — value substance is not validated here.)`,
        remediation: `Add the missing field(s) to the persona's jtbd entry. All four of {surface, time_budget, job, acceptance} are required before a prescription item can trace to it.`,
        reference: 'prescription-jtbd-traceability-reviewer.md#rules',
      });
    }
  }

  // ── 4-5. Walk prescription items: anchoring, deferral, ref resolution ──────
  const items = parsePrescriptionItems(prescriptionText);
  const itemsTotal = items.length;
  let itemsWithServes = 0;
  let itemsDeferred = 0;
  const unanchored = [];
  const brokenRefs = []; // { id, ref }
  const servedKeys = new Set();

  if (itemsTotal === 0) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionPath,
      message: 'No prescription items parsed (no `items:` list found, or it is empty). A Stage 2 prescription with zero items cannot be JTBD-traced. (Mechanical: shallow line-scan parser — if items are nested unusually, this is a parser limitation, not necessarily an empty prescription.)',
      remediation: 'Ensure the prescription has an `items:` list, each item a YAML map with at minimum an id and a serves_jtbd field.',
      reference: 'prescription-jtbd-traceability-reviewer.md#what-you-check',
    });
    return finalize(findings, 'no prescription items parsed', startedAt);
  }

  items.forEach((item, idx) => {
    const id = item.id || item.what || `item[${idx}]`;
    const sj = item.serves_jtbd;

    // Silence (no field, null, or an explicitly-empty list) → unanchored.
    if (sj === undefined || sj === null || (Array.isArray(sj) && sj.length === 0)) {
      unanchored.push(id);
      findings.push({
        severity: 'BLOCK',
        location: `${path.basename(prescriptionPath)} → ${id}`,
        message: `PRESCRIPTION_ITEM_UNANCHORED: item '${id}' has no serves_jtbd: field (or an empty one). Positioning directive without a functional anchor.`,
        remediation: `Add serves_jtbd: [<persona>/<surface>/<job-slug>, ...] tracing this item to ≥1 Stage 1 JTBD, or mark serves_jtbd: none-deferred with a serves_jtbd_reason explaining why it serves no JTBD this round.`,
        reference: 'docs/decisions/0004-jtbd-continuity-and-forge-provenance.md',
      });
      return;
    }

    // none-deferred scalar → must have a ≥10-word reason.
    if (typeof sj === 'string') {
      if (sj === 'none-deferred') {
        itemsDeferred += 1;
        const reason = item.serves_jtbd_reason ? String(item.serves_jtbd_reason).trim() : '';
        const wordCount = reason ? reason.split(/\s+/).filter(Boolean).length : 0;
        const lowered = reason.toLowerCase();
        const hollow = lowered === 'scope creep' || lowered === 'out of scope' || lowered === '';
        if (wordCount < 10 || hollow) {
          findings.push({
            severity: 'BLOCK',
            location: `${path.basename(prescriptionPath)} → ${id}`,
            message: `serves_jtbd: none-deferred on '${id}' but serves_jtbd_reason is ${reason === '' ? 'missing' : `too thin (${wordCount} word(s)${hollow ? `, hollow phrase "${reason}"` : ''})`}. A deferral must be a recorded conscious choice, not silence.`,
            remediation: 'Add serves_jtbd_reason with ≥10 words of substantive explanation (e.g. why this is infra-only / a dependency upgrade), not "scope creep" or "out of scope".',
            reference: 'prescription-jtbd-traceability-reviewer.md#rules',
          });
        } else {
          // Floor cleared. Whether the reason is SUBSTANTIVE (legit infra-only vs
          // scope-creep cover) is an agent judgment — do not block on it.
          findings.push({
            severity: 'INFO',
            location: `${path.basename(prescriptionPath)} → ${id}`,
            message: `serves_jtbd: none-deferred on '${id}' clears the ≥10-word floor (${wordCount} words). agent-verified: judge whether the reason is a legitimate infra-only deferral or scope-creep cover text (see .md § Rules).`,
            remediation: 'No mechanical action. Reviewing agent confirms the deferral is genuine.',
            reference: 'prescription-jtbd-traceability-reviewer.md#rules',
          });
        }
        return;
      }
      // Any other scalar string is an unrecognized serves_jtbd value → treat as a broken/unanchored shape.
      unanchored.push(id);
      findings.push({
        severity: 'BLOCK',
        location: `${path.basename(prescriptionPath)} → ${id}`,
        message: `serves_jtbd on '${id}' is the bare scalar "${sj}" — not a list of refs and not the literal 'none-deferred'. Unrecognized anchor shape.`,
        remediation: 'Use serves_jtbd: [<persona>/<surface>/<job-slug>, ...] or serves_jtbd: none-deferred (with a reason).',
        reference: 'docs/decisions/0004-jtbd-continuity-and-forge-provenance.md',
      });
      return;
    }

    // List of refs → resolve each against the index.
    if (Array.isArray(sj)) {
      itemsWithServes += 1;
      for (const ref of sj) {
        if (jtbdIndex.has(ref)) {
          servedKeys.add(ref);
        } else {
          brokenRefs.push({ id, ref });
          findings.push({
            severity: 'BLOCK',
            location: `${path.basename(prescriptionPath)} → ${id}`,
            message: `BROKEN_JTBD_REF: item '${id}' serves_jtbd '${ref}' does not resolve to any JTBD in the index. (typo in persona slug / stale ref after rename / JTBD removed from Stage 1 without updating the prescription.)`,
            remediation: `Fix the ref to match an entry in the JTBD index (<persona>/<surface>/<job-slug>), or remove it. Index keys: ${[...jtbdIndex.keys()].slice(0, 6).join(', ')}${jtbdIndex.size > 6 ? ', …' : ''}.`,
            reference: 'prescription-jtbd-traceability-reviewer.md#5-verify-jtbd-references-resolve',
          });
        }
      }
    }
  });

  // ── 6. Coverage check: every JTBD served by ≥1 item OR deferred-to-next-round ──
  const unaddressed = [];
  for (const [key, rec] of jtbdIndex.entries()) {
    if (servedKeys.has(key)) continue;
    const disp = (rec.disposition || '').toLowerCase();
    if (disp === 'deferred-to-next-round') continue;
    unaddressed.push(key);
  }
  if (unaddressed.length) {
    findings.push({
      severity: 'WARN',
      location: 'research/personas/ ↔ prescription',
      message: `JTBD_UNADDRESSED: ${unaddressed.length} JTBD(s) have no serving prescription item and no disposition: deferred-to-next-round — ${unaddressed.slice(0, 8).join(', ')}${unaddressed.length > 8 ? ', …' : ''}.`,
      remediation: 'Either add a prescription item that serves each, or mark the JTBD entry disposition: deferred-to-next-round (with a reason). Some JTBDs may legitimately pass through unchanged — this is a warning, not a block.',
      reference: 'prescription-jtbd-traceability-reviewer.md#6-coverage-check',
    });
  }

  // ── 7. Wedge ↔ JTBD coherence (spec step 7) — AGENT JUDGMENT, never blocks ──
  const wedgesDeclared =
    (blueprintYml && blueprintYml.pilot_profile && blueprintYml.pilot_profile.wedges) ||
    /^\s*wedges:/m.test(prescriptionText);
  if (wedgesDeclared) {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml pilot_profile.wedges / prescription wedges:',
      message: 'WEDGE_JTBD_ALIGNMENT is agent-verified (see .md spec step 7). Whether the JTBDs served by items inside a wedge are semantically coherent with the wedge\'s stated intent requires judgment and is not mechanically checked here.',
      remediation: 'Reviewing agent confirms each wedge\'s items serve JTBDs coherent with the wedge intent (e.g. a "navigation simplification" wedge should not be carried entirely by first-time-visitor JTBDs while claiming returning-user benefit).',
      reference: 'prescription-jtbd-traceability-reviewer.md#7-wedge-alignment-check',
    });
  }

  // ── Counts surfaced as one informational finding (mirrors the .md report block) ──
  findings.push({
    severity: 'INFO',
    location: prescriptionPath,
    message:
      `ITEMS_TOTAL=${itemsTotal} ITEMS_WITH_SERVES_JTBD=${itemsWithServes} ITEMS_DEFERRED=${itemsDeferred} ` +
      `ITEMS_UNANCHORED=${unanchored.length} BROKEN_JTBD_REFS=${brokenRefs.length} ` +
      `JTBD_INDEX_SIZE=${jtbdIndex.size} JTBDS_ADDRESSED=${servedKeys.size} JTBDS_UNADDRESSED=${unaddressed.length}. ` +
      `(Mechanical scope: persona/prescription parsing is a shallow dep-free line-scan — field PRESENCE + scalar capture, not deep YAML schema validation.)`,
    remediation: 'No action — counts only.',
    reference: 'prescription-jtbd-traceability-reviewer.md#how-to-report',
  });

  const summary = `${variant}: ${itemsTotal} items (${itemsWithServes} traced, ${itemsDeferred} deferred, ${unanchored.length} unanchored), ${brokenRefs.length} broken refs, JTBD index ${jtbdIndex.size} (${servedKeys.size} addressed, ${unaddressed.length} unaddressed)`;
  return finalize(findings, summary, startedAt);
}

// ── Self-test (node prescription-jtbd-traceability-reviewer.mjs) ─────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  let n = 0;
  const ok = (cond, msg) => { assert(cond, msg); n++; };

  // ── unit: jobSlug ──
  ok(jobSlug('Sees 3+ named shipped products within 5 seconds') === 'sees-3-named-shipped-products', 'jobSlug: first 5 words, kebab, strips punctuation');
  ok(jobSlug('') === '', 'jobSlug: empty');

  // ── unit: splitFrontmatter ──
  const fm = splitFrontmatter('---\nname: Peer Architect\njtbd:\n  - surface: hero\n---\nbody text');
  ok(fm.frontmatter.includes('jtbd:') && fm.body.trim() === 'body text', 'splitFrontmatter: splits on --- delimiters');
  ok(splitFrontmatter('no frontmatter here').frontmatter === '', 'splitFrontmatter: none when no leading ---');

  // ── unit: parseJtbdBlock (list shape) ──
  const j1 = parseJtbdBlock(
    'jtbd:\n' +
    '  - surface: hero\n' +
    '    time_budget: 5s\n' +
    '    job: see 3+ named shipped products\n' +
    '    acceptance: 3+ product links visible above the fold\n' +
    '  - surface: contact\n' +
    '    time_budget: 30s\n' +
    '    job: find a way to reach out\n' +
    '    acceptance: email link present\n' +
    '    disposition: deferred-to-next-round\n'
  );
  ok(j1.length === 2, 'parseJtbdBlock: two list entries');
  ok(j1[0].surface === 'hero' && j1[0].time_budget === '5s', 'parseJtbdBlock: scalars captured');
  ok(j1[1].disposition === 'deferred-to-next-round', 'parseJtbdBlock: disposition captured');

  // ── unit: parseJtbdBlock (inline keyed-map shape) ──
  const j2 = parseJtbdBlock('jtbd:\n  hero: { surface: hero, time_budget: 5s, job: do the thing now, acceptance: it works }\n');
  ok(j2.length === 1 && j2[0].job === 'do the thing now', 'parseJtbdBlock: inline keyed-map shape');

  // ── unit: parsePrescriptionItems (inline list, none-deferred, block list) ──
  const items = parsePrescriptionItems(
    'items:\n' +
    '  - id: surface-products\n' +
    '    what: hero shows products\n' +
    '    serves_jtbd: [peer-architect/hero/see-3-named-shipped-products]\n' +
    '  - id: dep-upgrade\n' +
    '    serves_jtbd: none-deferred\n' +
    '    serves_jtbd_reason: bumps the astro toolchain to fix a build break; no user-facing surface changes this round\n' +
    '  - id: block-list-item\n' +
    '    serves_jtbd:\n' +
    '      - peer-architect/contact/find-a-way-to\n' +
    '      - peer-architect/hero/see-3-named-shipped-products\n' +
    '  - id: orphan\n' +
    '    what: rewrite identity frame\n'
  );
  ok(items.length === 4, 'parsePrescriptionItems: four items');
  ok(Array.isArray(items[0].serves_jtbd) && items[0].serves_jtbd[0] === 'peer-architect/hero/see-3-named-shipped-products', 'parsePrescriptionItems: inline list');
  ok(items[1].serves_jtbd === 'none-deferred' && /astro/.test(items[1].serves_jtbd_reason), 'parsePrescriptionItems: none-deferred scalar + reason');
  ok(Array.isArray(items[2].serves_jtbd) && items[2].serves_jtbd.length === 2, 'parsePrescriptionItems: block list of refs');
  ok(items[3].serves_jtbd === undefined, 'parsePrescriptionItems: orphan has no serves_jtbd');

  // ── integration: full review against an in-memory temp dir ──
  const os = await import('node:os');
  const fsp = fs;
  const mkdtemp = (await import('node:fs')).mkdtempSync;

  async function scaffold(files) {
    const dir = mkdtemp(path.join(os.tmpdir(), 'jtbd-rev-'));
    for (const [rel, content] of Object.entries(files)) {
      const fp = path.join(dir, rel);
      await fsp.mkdir(path.dirname(fp), { recursive: true });
      await fsp.writeFile(fp, content, 'utf8');
    }
    return dir;
  }

  const PERSONA = '---\n' +
    'name: Peer Architect\n' +
    'jtbd:\n' +
    '  - surface: hero\n' +
    '    time_budget: 5s\n' +
    '    job: see 3+ named shipped products\n' +
    '    acceptance: 3+ product links visible above the fold\n' +
    '  - surface: contact\n' +
    '    time_budget: 30s\n' +
    '    job: find a way to reach out\n' +
    '    acceptance: email link present\n' +
    '    disposition: deferred-to-next-round\n' +
    '---\nPersona body.\n';

  // Case A — clean brownfield: traced item + deferred-to-next-round JTBD → PASS (INFO only).
  const goodPrescription =
    'variant: brownfield\n' +
    'items:\n' +
    '  - id: surface-products\n' +
    '    serves_jtbd: [peer-architect/hero/see-3-named-shipped-products]\n';
  const dirA = await scaffold({
    'blueprint.yml': 'variant: brownfield\n',
    'research/personas/peer-architect.md': PERSONA,
    '02-prescription.yml': goodPrescription,
  });
  const resA = await review({ targetDir: dirA, blueprintYml: { variant: 'brownfield' } });
  ok(resA.status === 'PASS', `Case A clean brownfield PASS (got ${resA.status})`);
  ok(resA.metadata.reviewer === NAME, 'Case A metadata.reviewer set');

  // Case B — unanchored item (orphan) + broken ref → BLOCKED.
  const badPrescription =
    'items:\n' +
    '  - id: surface-products\n' +
    '    serves_jtbd: [peer-architect/hero/TYPO-does-not-exist]\n' +
    '  - id: orphan\n' +
    '    what: rewrite identity frame\n';
  const dirB = await scaffold({
    'blueprint.yml': 'variant: brownfield\n',
    'research/personas/peer-architect.md': PERSONA,
    '02-prescription.yml': badPrescription,
  });
  const resB = await review({ targetDir: dirB, blueprintYml: { variant: 'brownfield' } });
  ok(resB.status === 'BLOCKED', `Case B unanchored+broken-ref BLOCKED (got ${resB.status})`);
  ok(resB.findings.some((f) => /BROKEN_JTBD_REF/.test(f.message)), 'Case B reports BROKEN_JTBD_REF');
  ok(resB.findings.some((f) => /PRESCRIPTION_ITEM_UNANCHORED/.test(f.message)), 'Case B reports UNANCHORED');

  // Case C — none-deferred with a thin reason → BLOCKED.
  const thinDefer =
    'items:\n' +
    '  - id: x\n' +
    '    serves_jtbd: none-deferred\n' +
    '    serves_jtbd_reason: scope creep\n';
  const dirC = await scaffold({
    'blueprint.yml': 'variant: midstream\n',
    'research/personas/peer-architect.md': PERSONA,
    'prescription.yml': thinDefer,
  });
  const resC = await review({ targetDir: dirC, blueprintYml: { variant: 'midstream' } });
  ok(resC.status === 'BLOCKED', `Case C thin none-deferred BLOCKED (got ${resC.status})`);
  ok(resC.findings.some((f) => /hollow phrase|too thin/.test(f.message)), 'Case C flags hollow/thin reason');

  // Case D — greenfield → PASS, out of scope.
  const dirD = await scaffold({ 'blueprint.yml': 'variant: greenfield\n' });
  const resD = await review({ targetDir: dirD, blueprintYml: { variant: 'greenfield' } });
  ok(resD.status === 'PASS' && resD.findings.some((f) => /OUT_OF_SCOPE_FOR_VARIANT/.test(f.message)), 'Case D greenfield out of scope PASS');

  // Case E — prescription missing → BLOCKED PRESCRIPTION_MISSING.
  const dirE = await scaffold({ 'blueprint.yml': 'variant: brownfield\n', 'research/personas/peer-architect.md': PERSONA });
  const resE = await review({ targetDir: dirE, blueprintYml: { variant: 'brownfield' } });
  ok(resE.status === 'BLOCKED' && resE.findings.some((f) => /PRESCRIPTION_MISSING/.test(f.message)), 'Case E prescription missing BLOCKED');

  // Case F — personas with no jtbd block → STAGE_1_INCOMPLETE BLOCKED.
  const dirF = await scaffold({
    'blueprint.yml': 'variant: brownfield\n',
    'research/personas/peer-architect.md': '---\nname: Peer Architect\n---\nNo jtbd here.\n',
    '02-prescription.yml': goodPrescription,
  });
  const resF = await review({ targetDir: dirF, blueprintYml: { variant: 'brownfield' } });
  ok(resF.status === 'BLOCKED' && resF.findings.some((f) => /STAGE_1_INCOMPLETE/.test(f.message)), 'Case F no-jtbd STAGE_1_INCOMPLETE BLOCKED');

  // Case G — JTBD missing a required field (acceptance) → JTBD_INCOMPLETE_UPSTREAM BLOCKED.
  const incompletePersona = '---\njtbd:\n  - surface: hero\n    time_budget: 5s\n    job: see the products now please\n---\n';
  const dirG = await scaffold({
    'blueprint.yml': 'variant: brownfield\n',
    'research/personas/peer-architect.md': incompletePersona,
    '02-prescription.yml': 'items:\n  - id: a\n    serves_jtbd: [peer-architect/hero/see-the-products-now-please]\n',
  });
  const resG = await review({ targetDir: dirG, blueprintYml: { variant: 'brownfield' } });
  ok(resG.status === 'BLOCKED' && resG.findings.some((f) => /JTBD_INCOMPLETE_UPSTREAM/.test(f.message)), 'Case G missing acceptance → JTBD_INCOMPLETE_UPSTREAM');

  // Case H — sibling <slug>.jtbd.md (no frontmatter) is ingested; unaddressed JTBD → WARN.
  const siblingJtbd =
    'jtbd:\n' +
    '  - surface: hero\n' +
    '    time_budget: 5s\n' +
    '    job: see the named products fast\n' +
    '    acceptance: links visible\n' +
    '  - surface: pricing\n' +
    '    time_budget: 20s\n' +
    '    job: understand the cost model\n' +
    '    acceptance: price table visible\n';
  const dirH = await scaffold({
    'blueprint.yml': 'variant: brownfield\n',
    'research/personas/peer-architect.md': '---\nname: Peer Architect\n---\nbody\n',
    'research/personas/peer-architect.jtbd.md': siblingJtbd,
    '02-prescription.yml': 'items:\n  - id: a\n    serves_jtbd: [peer-architect/hero/see-the-named-products-fast]\n',
  });
  const resH = await review({ targetDir: dirH, blueprintYml: { variant: 'brownfield' } });
  ok(resH.status === 'WARN', `Case H sibling jtbd + one unaddressed → WARN (got ${resH.status})`);
  ok(resH.findings.some((f) => /JTBD_UNADDRESSED/.test(f.message)), 'Case H reports JTBD_UNADDRESSED');

  // Case I — never throws on a totally absent targetDir.
  const resI = await review({ targetDir: path.join(os.tmpdir(), 'jtbd-rev-does-not-exist-zzz'), blueprintYml: undefined });
  ok(resI && typeof resI.status === 'string', 'Case I missing dir degrades to a finding, never throws');

  console.log(`prescription-jtbd-traceability-reviewer self-test: PASS (${n} assertions)`);
}
