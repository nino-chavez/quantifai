/**
 * prescription-evidence-reviewer.mjs — executable pair for the paired .md spec.
 * The Stage 2 → Stage 3 gate for the MIDSTREAM and BROWNFIELD variants
 * (greenfield skips this; it runs design-principles-reviewer instead).
 * Implements the ADR-0002 reviewer contract so the gate runs in CI / CLI / any
 * node, outside Claude Code:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (paired .md § "How to report"): the prescription must be a faithful
 * translation of diagnose evidence into ordered action. The gate BLOCKS when
 *   - the prescription artifact is missing, OR
 *   - any change item lacks evidence (a specific path/URL, not a hand-wave), OR
 *   - any change item lacks a monetization_side, OR
 *   - the items are not ordered by impact descending, OR
 *   - (brownfield) a high/critical finding in 01-diagnose.md has neither a
 *     prescription item nor an explicit `deferred: <reason>`, OR
 *   - a declared monetization side (pilot_profile + secondary_pilots) gets zero
 *     items and no deferral (MONETIZATION_GAP).
 * Greenfield → PASS ("out of scope for this variant").
 *
 * `blueprintYml` is passed by some callers as only a partial object (the doctor
 * passes `{ tier }`), so variant / pilot_profile / secondary_pilots are read
 * directly from <targetDir>/blueprint.yml — like cost-gate-reviewer reads the
 * cost block via the lib. Dependency-free node ESM.
 *
 * Reuses tools/lib/cost-dial.mjs (parseInlineMap-style line-scan, splitTopLevelCommas)
 * for the shallow-YAML extraction. The prescription YAML is shallow by contract
 * (an items block of scalar / inline-map children) — a line-scan parser handles
 * it. Deep / arbitrarily-nested YAML is NOT validated; the per-item check is
 * scoped to FIELD PRESENCE (what / why / impact / evidence / monetization_side)
 * and is reported as such. See the "scoped out" note in the field-presence finding.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

const NAME = 'prescription-evidence-reviewer';

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

// ── Shallow-YAML helpers (line-scan, cost-dial.mjs lineage) ──────────────────

function stripComment(s) {
  // Cut a trailing ` # comment` that is not inside quotes. Item values are bare
  // words or quoted strings; the only `#` we keep is one inside quotes.
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
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
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/.exec(piece);
    if (!m) continue;
    out[m[1]] = unquote(m[2]);
  }
  return out;
}

function indentOf(line) {
  return line.length - line.replace(/^\s+/, '').length;
}

// Read a top-level scalar (e.g. `variant: brownfield`) from a YAML string.
function readTopLevelScalar(ymlText, key) {
  for (const raw of ymlText.split('\n')) {
    const m = new RegExp(`^${key}:\\s*(.*)$`).exec(raw);
    if (m) return unquote(stripComment(m[1]).trim());
  }
  return null;
}

// ── blueprint.yml extraction (variant + declared monetization sides) ─────────

function readBlueprint(targetDir) {
  try {
    return readFileSync(path.join(targetDir, 'blueprint.yml'), 'utf8');
  } catch {
    return null;
  }
}

function extractVariant(ymlText) {
  return (readTopLevelScalar(ymlText, 'variant') || '').toLowerCase() || null;
}

// Declared monetization sides = pilot_profile.monetization_side (a 2-space child
// scalar) + every monetization_side appearing inside a secondary_pilots: block.
// secondary_pilots is not in the schema yet (pilot-profile-template.md § multi-
// pilot), so we accept any monetization_side line nested under it.
function extractDeclaredSides(ymlText) {
  const lines = ymlText.split('\n');
  const sides = new Set();

  // pilot_profile.monetization_side
  let inPilot = false;
  let pilotIndent = 0;
  for (const raw of lines) {
    if (/^pilot_profile:\s*(#.*)?$/.test(raw)) {
      inPilot = true;
      pilotIndent = indentOf(raw);
      continue;
    }
    if (inPilot) {
      if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
      if (indentOf(raw) <= pilotIndent && raw.trim() !== '') {
        inPilot = false; // dedent to a sibling top-level key
      } else {
        const m = /^\s+monetization_side:\s*(.*)$/.exec(raw);
        if (m) {
          const v = unquote(stripComment(m[1]).trim());
          if (v) sides.add(v.toLowerCase());
        }
      }
    }
  }

  // secondary_pilots[].monetization_side (block scan; tolerate inline maps too)
  let inSecondary = false;
  let secIndent = 0;
  for (const raw of lines) {
    if (/^secondary_pilots:\s*(.*)$/.test(raw)) {
      inSecondary = true;
      secIndent = indentOf(raw);
      // inline form: secondary_pilots: [ { monetization_side: coach }, ... ]
      const inline = raw.slice(raw.indexOf(':') + 1);
      for (const m of inline.matchAll(/monetization_side\s*:\s*([A-Za-z0-9_-]+)/g)) {
        sides.add(unquote(m[1]).toLowerCase());
      }
      continue;
    }
    if (inSecondary) {
      if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
      if (indentOf(raw) <= secIndent && raw.trim() !== '') {
        inSecondary = false;
      } else {
        for (const m of raw.matchAll(/monetization_side\s*:\s*["']?([A-Za-z0-9_-]+)["']?/g)) {
          sides.add(m[1].toLowerCase());
        }
      }
    }
  }

  return [...sides];
}

// ── Prescription parsing (shallow items block) ───────────────────────────────

const ITEM_FIELDS = ['what', 'why', 'impact', 'evidence', 'monetization_side'];
const IMPACT_RANK = { critical: 4, high: 3, medium: 2, med: 2, low: 1 };

function impactRank(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(IMPACT_RANK, s)) return IMPACT_RANK[s];
  // numeric priority: lower number = higher priority by convention, but the spec
  // says "impact descending" — treat a bare number as a magnitude (higher = more
  // impact) UNLESS it reads like a rank (P1/priority 1). We only have the value,
  // so: pure integers are magnitudes; "p1"/"#1"-style are inverted ranks.
  const rankMatch = /^(?:p|#|priority\s*)?(\d+)$/i.exec(s);
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s); // magnitude
  if (rankMatch) return -parseInt(rankMatch[1], 10); // inverted rank (P1 > P2)
  return null;
}

/**
 * Parse the prescription YAML into a list of items. Each item is
 * { fields: {what,why,impact,evidence,monetization_side,deferred,...}, line }.
 * Handles two shallow shapes under an `items:` (or `prescription:`/`changes:`)
 * sequence:
 *   - items:
 *       - { what: ..., why: ..., impact: high, evidence: path, monetization_side: coach }
 *   - items:
 *       - what: ...
 *         why: ...
 *         impact: high
 * Deep/arbitrary nesting is NOT walked — values that span nested blocks are read
 * only at their scalar head. Returns { items, blockKey } or { items: null }.
 */
function parsePrescription(ymlText) {
  const lines = ymlText.split('\n');
  // Find the items sequence key (accept a few synonyms the spec uses).
  let start = -1;
  let blockKey = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(items|changes|prescription_items|change_items):\s*(#.*)?$/.exec(lines[i]);
    if (m) {
      start = i + 1;
      blockKey = m[1];
      break;
    }
  }
  if (start < 0) return { items: null, blockKey: null };

  const items = [];
  let current = null;
  let seqIndent = null; // indent of the `- ` markers

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    const ind = indentOf(raw);

    // Dedent past the items block (to a new top-level / sibling key) → stop.
    if (/^\S/.test(raw) && !raw.startsWith('-')) break;
    if (seqIndent != null && ind < seqIndent && raw.trim() !== '') break;

    const dashInline = /^(\s*)-\s*\{(.*)\}\s*$/.exec(raw); // - { k: v, ... }
    const dashScalar = /^(\s*)-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw); // - what: ...
    const dashBare = /^(\s*)-\s*$/.exec(raw); // - (fields on following lines)
    const childKV = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw); // key: value (no dash)

    if (dashInline) {
      if (seqIndent == null) seqIndent = dashInline[1].length;
      current = { fields: parseInlineMapLowerKeys(dashInline[2]), line: i + 1 };
      items.push(current);
      current = null; // inline item complete
    } else if (dashScalar) {
      if (seqIndent == null) seqIndent = dashScalar[1].length;
      current = { fields: {}, line: i + 1 };
      items.push(current);
      addField(current.fields, dashScalar[2], dashScalar[3]);
    } else if (dashBare) {
      if (seqIndent == null) seqIndent = dashBare[1].length;
      current = { fields: {}, line: i + 1 };
      items.push(current);
    } else if (childKV && current) {
      // Continuation line for the current item (deeper than the dash marker).
      if (seqIndent != null && ind <= seqIndent) {
        // Same/shallower indent without a dash and not a child → block ended.
        break;
      }
      addField(current.fields, childKV[2], childKV[3]);
    }
  }

  return { items, blockKey };
}

function parseInlineMapLowerKeys(braced) {
  const out = {};
  for (const [k, v] of Object.entries(parseInlineMap(braced))) out[k.toLowerCase()] = v;
  return out;
}

function addField(fields, key, rawValue) {
  const k = key.toLowerCase();
  // Only record the scalar head; a nested block (empty value, children below) is
  // recorded as present-but-empty so PRESENCE is detected without deep walking.
  const v = unquote(stripComment(rawValue).trim());
  // Don't clobber an already-set field with an empty continuation.
  if (fields[k] === undefined || (fields[k] === '' && v !== '')) fields[k] = v;
}

// ── 01-diagnose.md finding extraction (brownfield) ───────────────────────────

/**
 * Scan 01-diagnose.md for high/critical findings and return their identifiers.
 * A "finding" is heuristically a line/heading that carries an explicit severity
 * marker. We match common shapes:
 *   - "### Finding F1 — ... (impact: high)"  / "Severity: critical"
 *   - "- [HIGH] ..."  / "**High:** ..."  / "| F3 | high | ..."
 * Each returned finding has an `id` (best-effort label) + the `text` line, so the
 * cross-check can look for the id OR a deferral note in the prescription.
 * This is a regex scan, not a semantic parse — reported as such.
 */
function extractHighFindings(diagnoseText) {
  const out = [];
  const lines = diagnoseText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    // Must carry a high/critical severity signal AND look like a finding row,
    // not prose that merely contains the word "high".
    const hasSeverity =
      /\b(impact|severity|priority)\s*[:=]\s*(high|critical)\b/i.test(line) ||
      /\[(high|critical)\]/i.test(line) ||
      /\*\*\s*(high|critical)\s*[:\*]/i.test(line) ||
      /\|\s*(high|critical)\s*\|/i.test(line);
    if (!hasSeverity) continue;
    // Best-effort id: an F-number, a leading list/heading label, or the line text.
    let id = null;
    const fnum = /\b(F-?\d+|FINDING[- ]?\d+|D-?\d+)\b/i.exec(line);
    if (fnum) id = fnum[1].toUpperCase().replace(/\s+/g, '-');
    if (!id) {
      const heading = /^#+\s*(.+?)(?:\s*[—\-(].*)?$/.exec(line);
      if (heading) id = heading[1].trim();
    }
    if (!id) id = line.trim().replace(/^[-*|\s]+/, '').slice(0, 60);
    out.push({ id, severity: lower.includes('critical') ? 'critical' : 'high', text: line.trim(), lineNo: i + 1 });
  }
  return out;
}

// Does the prescription reference this finding id, or explicitly defer it?
function findingAddressed(finding, prescriptionText, items) {
  const id = finding.id;
  if (!id) return true; // can't anchor → don't manufacture a gap
  const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Reference by id anywhere in the prescription text (why-field citations, etc.)
  if (new RegExp(idEsc.replace(/-/g, '[- ]?'), 'i').test(prescriptionText)) return true;
  // Explicit deferral mentioning the id, or a global deferral note near it.
  for (const it of items) {
    const blob = Object.values(it.fields).join(' ');
    if (/deferred/i.test(blob) && new RegExp(idEsc.replace(/-/g, '[- ]?'), 'i').test(blob)) return true;
  }
  return false;
}

// ── The review ───────────────────────────────────────────────────────────────

export default async function review({ targetDir }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  // 1. Read blueprint.yml + determine variant.
  const blueprintText = readBlueprint(artifactsRoot);
  if (blueprintText == null) {
    findings.push({
      severity: 'BLOCK',
      location: 'blueprint.yml',
      message: 'No blueprint.yml at the initiative root — cannot determine variant or declared monetization sides.',
      remediation: 'Run this reviewer from the initiative root, or fix the targetDir. blueprint.yml is required for every Blueprint initiative.',
      reference: 'docs/variant-selection.md',
    });
    return finalize(findings, 'no blueprint.yml', startedAt);
  }

  const variant = extractVariant(blueprintText);
  if (variant === 'greenfield' || variant === 'research') {
    const why = variant === 'greenfield'
      ? 'greenfield — design-principles-reviewer gates instead'
      : 'research — prescription gate is midstream/brownfield only';
    return result('PASS', [], `${why} (out of scope for this variant)`, startedAt);
  }
  if (variant !== 'midstream' && variant !== 'brownfield') {
    // Unknown / unset variant: don't silently pass, but don't BLOCK on a config
    // ambiguity this reviewer can't resolve. WARN so the operator sets it.
    findings.push({
      severity: 'WARN',
      location: 'blueprint.yml variant',
      message: `variant is '${variant ?? '(unset)'}' — expected greenfield | midstream | brownfield. This gate applies only to midstream/brownfield; treating as midstream for the evidence checks.`,
      remediation: 'Set `variant:` explicitly in blueprint.yml per docs/variant-selection.md.',
      reference: 'docs/variant-selection.md',
    });
  }
  const isBrownfield = variant === 'brownfield';

  // 2. Locate the prescription artifact.
  const prescriptionName = isBrownfield ? '02-prescription.yml' : 'prescription.yml';
  const prescriptionPath = path.join(artifactsRoot, prescriptionName);
  let prescriptionText;
  try {
    if (!existsSync(prescriptionPath)) throw new Error('missing');
    prescriptionText = readFileSync(prescriptionPath, 'utf8');
  } catch {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message: `Prescription artifact '${prescriptionName}' not found at the initiative root (variant=${variant}).`,
      remediation: `Author ${prescriptionName} with an \`items:\` block — one entry per change, each carrying what / why / impact / evidence / monetization_side. See prescription-evidence-reviewer.md.`,
      reference: 'prescription-evidence-reviewer.md',
    });
    return finalize(findings, `${prescriptionName} missing`, startedAt);
  }

  // 3. Parse items.
  let parsed;
  try {
    parsed = parsePrescription(prescriptionText);
  } catch (err) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message: `Could not parse the prescription items block (line-scan parser error: ${err.message}). The prescription must be a shallow items: block of scalar / inline-map entries.`,
      remediation: 'Flatten the items block to one inline-map or scalar-field entry per change. Deep/arbitrary YAML nesting is not supported by this gate.',
      reference: 'prescription-evidence-reviewer.md',
    });
    return finalize(findings, 'unparseable prescription', startedAt);
  }

  if (!parsed.items) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message: 'No items: block found in the prescription. Expected `items:` (or changes/change_items/prescription_items) with one entry per change.',
      remediation: 'Add an `items:` sequence. Each entry: { what, why, impact, evidence, monetization_side }.',
      reference: 'prescription-evidence-reviewer.md',
    });
    return finalize(findings, 'no items block', startedAt);
  }

  const items = parsed.items;
  if (items.length === 0) {
    findings.push({
      severity: 'BLOCK',
      location: `${prescriptionName} ${parsed.blockKey}:`,
      message: 'The items block is empty — a prescription with zero change items cannot translate diagnose evidence into action.',
      remediation: 'Add at least one change item, or document why the diagnose surfaced nothing actionable.',
      reference: 'prescription-evidence-reviewer.md',
    });
    return finalize(findings, '0 items', startedAt);
  }

  // 3b/4. Per-item field PRESENCE (scoped: presence, not deep validation).
  let withEvidence = 0;
  let withMonetization = 0;
  const sidesCovered = new Set();
  const missingFieldRows = [];

  items.forEach((it, idx) => {
    const f = it.fields;
    const has = (k) => f[k] != null && String(f[k]).trim() !== '';
    const deferred = has('deferred');

    const missing = ITEM_FIELDS.filter((k) => !has(k));
    if (has('evidence') || deferred) withEvidence += 1; // a deferral is a valid disposition for evidence
    if (has('monetization_side')) {
      withMonetization += 1;
      sidesCovered.add(String(f.monetization_side).trim().toLowerCase());
    }

    if (missing.length && !deferred) {
      missingFieldRows.push({ idx: idx + 1, line: it.line, missing });
    } else if (missing.length && deferred) {
      // Deferred items only need a reason; still note if monetization_side absent
      // (a deferral must still name the side it would have served for gap math).
      if (!has('monetization_side')) {
        missingFieldRows.push({ idx: idx + 1, line: it.line, missing: ['monetization_side'], deferred: true });
      }
    }
  });

  if (missingFieldRows.length) {
    const detail = missingFieldRows
      .slice(0, 8)
      .map((r) => `item ${r.idx} (line ${r.line}): missing ${r.missing.join(', ')}${r.deferred ? ' [deferred]' : ''}`)
      .join('; ');
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message:
        `${missingFieldRows.length}/${items.length} item(s) missing required field(s). Required per item: ${ITEM_FIELDS.join(', ')} ` +
        `(a \`deferred: <reason>\` item is exempt from what/why/impact/evidence but must still name monetization_side). ` +
        `SCOPE NOTE: this checks field PRESENCE via a shallow line-scan — it does not deep-validate field contents. ${detail}.`,
      remediation:
        'Fill the missing fields. "Evidence" must be a specific screenshot/codebase/research path or URL — not "common pattern in the landscape". ' +
        'If a change is intentionally not yet justified, mark it `deferred: <reason>` instead of leaving fields blank.',
      reference: 'prescription-evidence-reviewer.md',
    });
  }

  // Spec: BLOCK if ITEMS_WITH_EVIDENCE < ITEMS (already covered by missing-field
  // BLOCK when evidence is the missing field; this finding makes the count explicit).
  if (withEvidence < items.length) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message: `ITEMS_WITH_EVIDENCE ${withEvidence} < ITEMS ${items.length}. Every change item needs evidence (a specific path/URL) or an explicit \`deferred: <reason>\`.`,
      remediation: 'Cite a concrete artifact path/URL for each item, or defer it with a reason. A hand-wave at "industry best practice" is not evidence.',
      reference: 'prescription-evidence-reviewer.md',
    });
  }
  if (withMonetization < items.length) {
    findings.push({
      severity: 'BLOCK',
      location: prescriptionName,
      message: `ITEMS_WITH_MONETIZATION_SIDE ${withMonetization} < ITEMS ${items.length}. Silence on monetization side fails — a change can help one market side while degrading another, invisibly.`,
      remediation: 'Add `monetization_side:` to every item (player/coach/organizer/buyer/seller/operator/... or the literal `single-sided`). Cross-side cost goes in the Why field.',
      reference: 'prescription-evidence-reviewer.md (rally-hq monetization-axis miss)',
    });
  }

  // 4. Ordering by impact (descending). Compare ranks across the full list.
  const ranks = items.map((it) => impactRank(it.fields.impact));
  const rankable = ranks.filter((r) => r != null);
  let ordering = 'unclear';
  if (rankable.length >= 2) {
    // Strictly: no later item may have a HIGHER rank than an earlier one.
    let ascendingViolation = null;
    for (let a = 0; a < ranks.length; a++) {
      if (ranks[a] == null) continue;
      for (let b = a + 1; b < ranks.length; b++) {
        if (ranks[b] == null) continue;
        if (ranks[b] > ranks[a]) {
          ascendingViolation = { a: a + 1, aImpact: items[a].fields.impact, b: b + 1, bImpact: items[b].fields.impact };
          break;
        }
      }
      if (ascendingViolation) break;
    }
    ordering = ascendingViolation ? 'by-surface' : 'by-impact';
    if (ascendingViolation) {
      findings.push({
        severity: 'BLOCK',
        location: prescriptionName,
        message:
          `Items are not ordered by impact descending: item ${ascendingViolation.b} (impact=${ascendingViolation.bImpact}) ranks ABOVE ` +
          `earlier item ${ascendingViolation.a} (impact=${ascendingViolation.a < ascendingViolation.b ? ascendingViolation.aImpact : ''}). ` +
          'Order by impact, not by surface or by ease.',
        remediation: 'Re-sort the items block highest-impact first. If two items are genuinely equal-impact, keep them adjacent.',
        reference: 'prescription-evidence-reviewer.md',
      });
    }
  } else {
    // Fewer than two rankable items → ordering is trivially fine / unknowable.
    ordering = rankable.length === 1 ? 'by-impact' : 'unclear';
  }

  // 4a. Monetization-side coverage vs declared sides.
  const declaredSides = extractDeclaredSides(blueprintText);
  const isSingleSidedLiteral = sidesCovered.has('single-sided');
  let monetizationGap = [];
  if (declaredSides.length > 1 && !isSingleSidedLiteral) {
    // Which declared sides have zero items AND no deferral naming them?
    const deferredSides = new Set();
    for (const it of items) {
      if (it.fields.deferred && it.fields.monetization_side) {
        deferredSides.add(String(it.fields.monetization_side).trim().toLowerCase());
      }
    }
    monetizationGap = declaredSides.filter((s) => !sidesCovered.has(s) && !deferredSides.has(s));
    if (monetizationGap.length) {
      findings.push({
        severity: 'BLOCK',
        location: 'blueprint.yml pilot_profile/secondary_pilots ⇄ ' + prescriptionName,
        message:
          `MONETIZATION_GAP: declared side(s) [${monetizationGap.join(', ')}] have zero prescription items and no deferral. ` +
          `Declared: [${declaredSides.join(', ')}]. Covered: [${[...sidesCovered].join(', ') || 'none'}]. ` +
          'Either all changes serve the easiest side (cherry-pick) or a side was silently dropped.',
        remediation: 'Add at least one item per declared side, or `deferred: <reason>` naming the dropped side. Cross-side degradation must be named in the affected item\'s Why.',
        reference: 'docs/_archive/2026-05-25-three-session-reconciliation.md § "Rally HQ session caught"',
      });
    }
  }

  // 5/6. Brownfield diagnose cross-check.
  let unresolvedFindings = [];
  let diagnoseScanned = false;
  if (isBrownfield) {
    const diagnosePath = path.join(artifactsRoot, '01-diagnose.md');
    let diagnoseText = null;
    try {
      if (existsSync(diagnosePath)) diagnoseText = readFileSync(diagnosePath, 'utf8');
    } catch {
      diagnoseText = null;
    }
    if (diagnoseText == null) {
      findings.push({
        severity: 'BLOCK',
        location: '01-diagnose.md',
        message: 'Brownfield variant but 01-diagnose.md is missing — the prescription cannot be cross-checked against the diagnose it must translate.',
        remediation: 'Produce 01-diagnose.md (Stage 1 brownfield deliverable) before the prescription gate. Every prescription item must trace to a diagnose finding.',
        reference: 'docs/variant-selection.md',
      });
    } else {
      diagnoseScanned = true;
      const highFindings = extractHighFindings(diagnoseText);
      for (const fnd of highFindings) {
        if (!findingAddressed(fnd, prescriptionText, items)) {
          unresolvedFindings.push(fnd);
        }
      }
      if (unresolvedFindings.length) {
        const detail = unresolvedFindings
          .slice(0, 6)
          .map((f) => `${f.id} (${f.severity}, 01-diagnose.md:${f.lineNo})`)
          .join('; ');
        findings.push({
          severity: 'BLOCK',
          location: '01-diagnose.md ⇄ ' + prescriptionName,
          message:
            `${unresolvedFindings.length} high/critical diagnose finding(s) have no prescription item and no explicit deferral: ${detail}. ` +
            'SCOPE NOTE: findings are detected by a regex scan for severity markers (impact/severity/priority: high|critical, [HIGH], **High:**, table cells) — ' +
            'it will miss findings that carry no machine-detectable severity marker. A finding "vanishing" between diagnose and prescription without acknowledgment fails.',
          remediation:
            'For each unresolved finding: add a prescription item whose Why cites the finding id, OR add a `deferred: <reason>` note referencing the id. ' +
            'If the scan mis-detected a non-finding, give your real findings explicit ids (e.g. "F1", "impact: high") so the cross-check can anchor on them.',
          reference: 'prescription-evidence-reviewer.md',
        });
      }
    }
  }

  const summary =
    `${items.length} items, evidence=${withEvidence}/${items.length}, ` +
    `monetization=${withMonetization}/${items.length}, ordering=${ordering}` +
    (declaredSides.length ? `, sides covered ${[...sidesCovered].length}/${declaredSides.length}` : '') +
    (isBrownfield ? `, diagnose ${diagnoseScanned ? `unresolved=${unresolvedFindings.length}` : 'MISSING'}` : '') +
    (monetizationGap.length ? `, gap=[${monetizationGap.join(',')}]` : '');

  return finalize(findings, summary, startedAt);
}

// ── Self-test (node prescription-evidence-reviewer.mjs) ──────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  let testCount = 0;
  const tmpDirs = [];
  function fixture(files) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'presc-rev-'));
    tmpDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }
  async function run(files) {
    return review({ targetDir: fixture(files) });
  }
  async function check(label, files, predicate) {
    testCount += 1;
    const r = await run(files);
    assert(predicate(r), `${label} — got status=${r.status}, summary="${r.metadata.targetSummary}", findings=${JSON.stringify(r.findings.map((f) => f.message.slice(0, 70)))}`);
  }

  // --- greenfield → PASS (out of scope) ---
  await check('greenfield passes', { 'blueprint.yml': 'variant: greenfield\n' }, (r) => r.status === 'PASS');

  // --- missing blueprint.yml → BLOCKED ---
  await check('no blueprint.yml blocks', {}, (r) => r.status === 'BLOCKED');

  // --- midstream, missing prescription.yml → BLOCKED ---
  await check('midstream missing prescription blocks', { 'blueprint.yml': 'variant: midstream\n' }, (r) => r.status === 'BLOCKED' && /prescription\.yml.*not found/.test(r.findings[0].message));

  // --- brownfield looks for 02-prescription.yml specifically ---
  await check('brownfield wants 02-prescription.yml', { 'blueprint.yml': 'variant: brownfield\n', 'prescription.yml': 'items:\n  - { what: x }\n' }, (r) => r.status === 'BLOCKED' && /02-prescription\.yml.*not found/.test(r.findings[0].message));

  // --- midstream, complete + ordered + single-sided → PASS ---
  const goodMidstream = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: "single-sided"\n',
    'prescription.yml': `items:
  - { what: "Rework checkout CTA", why: "diagnose F1 conversion drop", impact: high, evidence: "research/heatmap.png", monetization_side: buyer }
  - { what: "Tidy footer links", why: "minor IA cleanup", impact: low, evidence: "research/ia-audit.md", monetization_side: buyer }
`,
  };
  await check('good midstream passes', goodMidstream, (r) => r.status === 'PASS' && /ordering=by-impact/.test(r.metadata.targetSummary));

  // --- ordering violation (low before high) → BLOCKED ---
  const badOrder = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: single-sided\n',
    'prescription.yml': `items:
  - { what: "Tidy footer", why: "minor", impact: low, evidence: "research/a.md", monetization_side: buyer }
  - { what: "Fix checkout", why: "big", impact: high, evidence: "research/b.md", monetization_side: buyer }
`,
  };
  await check('bad ordering blocks', badOrder, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /not ordered by impact/.test(f.message)));

  // --- missing evidence → BLOCKED ---
  const noEvidence = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: single-sided\n',
    'prescription.yml': `items:
  - { what: "Fix checkout", why: "big", impact: high, monetization_side: buyer }
`,
  };
  await check('missing evidence blocks', noEvidence, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /ITEMS_WITH_EVIDENCE/.test(f.message)));

  // --- missing monetization_side → BLOCKED ---
  const noSide = {
    'blueprint.yml': 'variant: midstream\n',
    'prescription.yml': `items:
  - { what: "Fix checkout", why: "big", impact: high, evidence: "research/b.md" }
`,
  };
  await check('missing monetization_side blocks', noSide, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /ITEMS_WITH_MONETIZATION_SIDE/.test(f.message)));

  // --- deferred item is exempt from evidence (still PASS) ---
  const deferred = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: single-sided\n',
    'prescription.yml': `items:
  - { what: "Fix checkout", why: "big", impact: high, evidence: "research/b.md", monetization_side: buyer }
  - { what: "Rebuild dashboard", deferred: "out of scope this cycle", monetization_side: buyer }
`,
  };
  await check('deferred item exempt from evidence', deferred, (r) => r.status === 'PASS');

  // --- monetization gap: two declared sides, only one covered → BLOCKED ---
  const gap = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: coach\nsecondary_pilots:\n  - slug: org\n    monetization_side: organizer\n',
    'prescription.yml': `items:
  - { what: "Coach roster view", why: "diagnose F2", impact: high, evidence: "research/coach.md", monetization_side: coach }
`,
  };
  await check('monetization gap blocks', gap, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /MONETIZATION_GAP/.test(f.message) && /organizer/.test(f.message)));

  // --- monetization gap cleared by a deferral naming the side ---
  const gapDeferred = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: coach\nsecondary_pilots:\n  - monetization_side: organizer\n',
    'prescription.yml': `items:
  - { what: "Coach roster view", why: "diagnose F2", impact: high, evidence: "research/coach.md", monetization_side: coach }
  - { what: "Organizer bracket tool", deferred: "phase 2", monetization_side: organizer }
`,
  };
  await check('gap cleared by deferral', gapDeferred, (r) => r.status === 'PASS');

  // --- brownfield: high finding with no prescription ref → BLOCKED ---
  const brownGap = {
    'blueprint.yml': 'variant: brownfield\npilot_profile:\n  monetization_side: single-sided\n',
    '01-diagnose.md': '### Finding F1 — checkout abandonment (impact: high)\nUsers drop at payment.\n\n### F2 — slow search (severity: high)\n',
    '02-prescription.yml': `items:
  - { what: "Fix checkout", why: "addresses F1", impact: high, evidence: "research/b.md", monetization_side: buyer }
`,
  };
  await check('brownfield unresolved finding blocks', brownGap, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /high\/critical diagnose finding/.test(f.message) && /F2/.test(f.message)));

  // --- brownfield: all high findings addressed (ref + deferral) → PASS ---
  const brownGood = {
    'blueprint.yml': 'variant: brownfield\npilot_profile:\n  monetization_side: single-sided\n',
    '01-diagnose.md': '### Finding F1 — checkout abandonment (impact: high)\n\n### F2 — slow search (severity: high)\n',
    '02-prescription.yml': `items:
  - { what: "Fix checkout", why: "addresses F1", impact: high, evidence: "research/b.md", monetization_side: buyer }
  - { what: "Search overhaul", why: "F2 latency", impact: medium, evidence: "research/search.md", monetization_side: buyer, deferred: "scoped but tracked" }
`,
  };
  await check('brownfield all findings addressed passes', brownGood, (r) => r.status === 'PASS');

  // --- brownfield missing 01-diagnose.md → BLOCKED ---
  const brownNoDiagnose = {
    'blueprint.yml': 'variant: brownfield\npilot_profile:\n  monetization_side: single-sided\n',
    '02-prescription.yml': 'items:\n  - { what: x, why: y, impact: high, evidence: "z.md", monetization_side: buyer }\n',
  };
  await check('brownfield missing diagnose blocks', brownNoDiagnose, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /01-diagnose\.md is missing/.test(f.message)));

  // --- nested-scalar item shape (not inline map) parses ---
  const nested = {
    'blueprint.yml': 'variant: midstream\npilot_profile:\n  monetization_side: single-sided\n',
    'prescription.yml': `items:
  - what: "Fix checkout"
    why: "diagnose F1"
    impact: high
    evidence: "research/b.md"
    monetization_side: buyer
  - what: "Footer cleanup"
    why: "ia audit"
    impact: low
    evidence: "research/ia.md"
    monetization_side: buyer
`,
  };
  await check('nested-scalar items parse + pass', nested, (r) => r.status === 'PASS' && /2 items/.test(r.metadata.targetSummary));

  // --- empty items block → BLOCKED ---
  await check('empty items blocks', { 'blueprint.yml': 'variant: midstream\n', 'prescription.yml': 'items:\n' }, (r) => r.status === 'BLOCKED' && r.findings.some((f) => /No items: block|items block is empty/.test(f.message)));

  // --- unset variant → WARN-level handling, still runs evidence checks ---
  const unsetVariant = {
    'blueprint.yml': 'tier: 2\n',
    'prescription.yml': 'items:\n  - { what: x, why: y, impact: high, evidence: "z.md", monetization_side: buyer }\n',
  };
  await check('unset variant warns but evaluates', unsetVariant, (r) => (r.status === 'WARN' || r.status === 'PASS') && r.findings.some((f) => /variant is/.test(f.message)));

  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  console.log(`prescription-evidence-reviewer self-test: PASS (${testCount} cases)`);
}
