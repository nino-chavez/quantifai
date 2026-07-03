/**
 * pilot-profile-lock-reviewer.mjs — executable pair for the paired .md spec.
 * Implements the ADR-0002 reviewer contract so the Stage 0 → Stage 1 pilot-lock
 * gate runs outside Claude Code (CLI / CI / any node):
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (encoded response to the 2026-05-22 rally-hq pilot-drift incident):
 * Stage 1 research has no falsifiable anchor until blueprint.yml `pilot_profile:`
 * is fully populated and the walkthrough_citation resolves to a real artifact.
 * Without a locked pilot, Stage 1 "evidence" drifts toward whichever pilot the
 * agent finds convenient and Stage 2 prescriptions inherit the drift.
 *
 *   - No blueprint.yml                              -> PASS (not a Blueprint initiative; per .md "skip").
 *   - No `pilot_profile:` block                     -> BLOCK.
 *   - Any of the 7 required fields empty/missing    -> BLOCK (one finding per field).
 *   - walkthrough_citation does not resolve to file -> BLOCK (load-bearing field).
 *   - competitors_in_scope / out_of_scope_pilots
 *     with < 1 entry                                -> BLOCK.
 *   - pilot_profile edited in last 14 days with no
 *     corresponding decisions/*pilot* ADR           -> BLOCK (silent amendment).
 *
 * This is the HYBRID mechanical subset. Three checks in the .md spec need agent
 * judgment and are NOT faked here — they are emitted as INFO findings pointing at
 * the .md, and never drive BLOCKED:
 *   - pain_point specificity smell-test (.md §4)
 *   - monetization_side generic-value WARN (.md §5)  [mechanical generic-list WARN only]
 *   - competitors_in_scope grounded-in-citation check (.md §6)
 *
 * YAML PARSING IS SHALLOW. The `pilot_profile:` block is scalar/list children with
 * no nesting, so a dependency-free line-scan parser (mirroring cost-dial.mjs's
 * approach) handles it. We scope validation to field PRESENCE + list-entry COUNT +
 * citation-file existence. We do NOT deep-validate value semantics — see the INFO
 * findings. Dependency-free node ESM. Never throws: risky reads degrade to findings.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const NAME = 'pilot-profile-lock-reviewer';

// The 7 fields the .md spec (§2) and template/blueprint.yml § pilot_profile declare required.
const REQUIRED_SCALARS = ['slug', 'display_name', 'pain_point', 'monetization_side', 'walkthrough_citation'];
const REQUIRED_LISTS = ['competitors_in_scope', 'out_of_scope_pilots'];
const REQUIRED_FIELDS = [...REQUIRED_SCALARS, ...REQUIRED_LISTS];

// Generic monetization_side values that warrant a WARN (.md §5). Membership is the
// only mechanical test; whether a generic value is *actually* wrong is agent judgment.
const GENERIC_SIDES = ['user', 'customer', 'stakeholder'];

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

// ── Shallow line-scan parser for the pilot_profile: block ────────────────────
// Mirrors cost-dial.mjs: find `^pilot_profile:`, collect indented children until
// dedent to a new top-level key. Children are scalars (`key: value`) or lists,
// in either inline (`[a, b]`) or block (`- a` / `- b`) form. No nesting expected.

function stripScalarComment(s) {
  // Cut a trailing ` # comment` not inside quotes. Pilot scalars are bare words or
  // quoted strings; an unquoted value can carry a trailing comment in the template.
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trim();
    }
  }
  return s.trim();
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
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

function parseInlineList(braced) {
  // braced: text between [ and ]. Empty or whitespace → []. Otherwise split on
  // top-level commas, drop blanks, unquote each entry.
  if (braced.trim() === '') return [];
  return splitTopLevelCommas(braced)
    .map((p) => unquote(stripScalarComment(p)))
    .filter((p) => p !== '');
}

/**
 * Parse a blueprint.yml string into { present, fields }. `fields` maps each
 * pilot_profile child key to:
 *   - scalar: { kind: 'scalar', value: <string> }
 *   - list:   { kind: 'list', items: [<string>...] }
 * Absent block → { present: false, fields: {} }. Never throws on shape.
 */
export function parsePilotProfile(ymlText) {
  const lines = ymlText.split('\n');
  const start = lines.findIndex((l) => /^pilot_profile:\s*(#.*)?$/.test(l));
  if (start < 0) return { present: false, fields: {} };

  const fields = {};
  let pendingList = null; // { key } when we've seen `key:` with no inline value and expect `-` items

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue; // blank / comment
    if (/^\S/.test(line)) break; // dedent to a new top-level key → block ends

    // Block-list item: `  - value` (deeper-indented than the owning key).
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item && pendingList) {
      fields[pendingList].items.push(unquote(stripScalarComment(item[1])));
      continue;
    }

    // `  key: value` (2-space child of pilot_profile).
    const kv = /^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2];
    pendingList = null;

    const trimmed = stripScalarComment(rawVal);
    if (trimmed.startsWith('[')) {
      // Inline list, possibly across the same line: `[a, b]`.
      const close = trimmed.lastIndexOf(']');
      const inner = close > 0 ? trimmed.slice(1, close) : trimmed.slice(1);
      fields[key] = { kind: 'list', items: parseInlineList(inner) };
    } else if (trimmed === '') {
      // Either an empty scalar OR the header of a block list. Default to an empty
      // list container that block-list items can append to; if no items follow it
      // reads as an empty list (count 0). A truly-empty scalar field also lands
      // here as { kind: 'list', items: [] } — but the required-field check treats
      // an empty list and an empty scalar identically (both "unfilled"), so the
      // BLOCK fires either way. Track it as a pending list target.
      fields[key] = { kind: 'list', items: [] };
      pendingList = key;
    } else {
      fields[key] = { kind: 'scalar', value: unquote(trimmed) };
    }
  }
  return { present: true, fields };
}

/** Read + parse the pilot_profile block from a target dir's blueprint.yml. */
function readPilotProfile(targetDir) {
  try {
    return parsePilotProfile(readFileSync(path.join(targetDir, 'blueprint.yml'), 'utf8'));
  } catch {
    return { present: false, fields: {} };
  }
}

/** True when a field is considered "filled" for the required-field gate. */
function fieldFilled(field) {
  if (!field) return false;
  if (field.kind === 'scalar') {
    const v = (field.value ?? '').trim();
    return v !== '' && v.toLowerCase() !== 'null' && v !== '~';
  }
  // list
  return Array.isArray(field.items) && field.items.length > 0;
}

/** Scalar value (trimmed) or '' for a field that is a list / absent. */
function scalarOf(fields, key) {
  const f = fields[key];
  return f && f.kind === 'scalar' ? (f.value ?? '').trim() : '';
}

/** List items or [] for a field that is a scalar / absent. */
function listOf(fields, key) {
  const f = fields[key];
  return f && f.kind === 'list' && Array.isArray(f.items) ? f.items : [];
}

/**
 * Detect a pilot_profile edit in the last `days` days via git, and whether a
 * pilot ADR exists. Returns { gitAvailable, recentlyEdited, adrFound, adrPaths }.
 * Never throws — git absence / non-repo degrades to { gitAvailable: false }.
 */
function detectRecentPilotEdit(targetDir, days = 14) {
  let recentlyEdited = false;
  let gitAvailable = true;
  try {
    // Lines touching pilot_profile in commits within the window. `-G` greps the
    // diff hunks; we restrict to blueprint.yml. Empty output → no recent edit.
    const out = execFileSync(
      'git',
      ['-C', targetDir, 'log', `--since=${days} days ago`, '-G', 'pilot_profile', '--', 'blueprint.yml'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    recentlyEdited = out.trim() !== '';
  } catch {
    gitAvailable = false;
  }

  const adrPaths = [];
  for (const dir of ['decisions', path.join('blueprint', 'decisions')]) {
    const abs = path.join(targetDir, dir);
    try {
      if (!existsSync(abs)) continue;
      for (const f of readdirSync(abs)) {
        if (/pilot[-_]?profile|pilot/i.test(f) && /\.md$/i.test(f)) adrPaths.push(path.join(dir, f));
      }
    } catch {
      /* unreadable dir → skip */
    }
  }
  return { gitAvailable, recentlyEdited, adrFound: adrPaths.length > 0, adrPaths };
}

export default async function review({ targetDir }) {
  const startedAt = Date.now();
  const findings = [];

  // Gate: not a Blueprint initiative → nothing to lock (per .md "Skip when ... no blueprint.yml").
  if (!existsSync(path.join(targetDir, 'blueprint.yml'))) {
    return result('PASS', [], 'no blueprint.yml — not a Blueprint initiative', startedAt);
  }
  // Research variant locks personas/JTBD (research/personas-and-jtbd.md), not a pilot_profile.
  const _pplYml = (() => { try { return readFileSync(path.join(targetDir, 'blueprint.yml'), 'utf8'); } catch { return ''; } })();
  if (/^variant:\s*research\b/m.test(_pplYml)) {
    return result('PASS', [], 'research — out of scope (research locks personas/JTBD, not a pilot_profile)', startedAt);
  }

  const { present, fields } = readPilotProfile(targetDir);

  // §1 — pilot_profile block must exist.
  if (!present) {
    findings.push({
      severity: 'BLOCK',
      location: 'blueprint.yml',
      message: 'No `pilot_profile:` block in blueprint.yml. Stage 1 research has no falsifiable anchor without a locked pilot.',
      remediation:
        'Add a pilot_profile: block with all 7 fields (slug, display_name, pain_point, monetization_side, walkthrough_citation, competitors_in_scope, out_of_scope_pilots). See template/docs/methodology/pilot-profile-template.md.',
      reference: 'pilot-profile-lock-reviewer.md#1-blueprintyml-exists-and-has-a-pilot_profile-block',
    });
    return finalize(findings, 'no pilot_profile: block', startedAt);
  }

  // §2 — every required field non-empty. One BLOCK per unfilled field.
  let filledCount = 0;
  for (const key of REQUIRED_FIELDS) {
    if (fieldFilled(fields[key])) {
      filledCount += 1;
      continue;
    }
    const isList = REQUIRED_LISTS.includes(key);
    findings.push({
      severity: 'BLOCK',
      location: `blueprint.yml pilot_profile.${key}`,
      message: isList
        ? `Required field '${key}' is empty — needs >= 1 entry. Even "none considered" is a position requiring an explicit declaration; an empty list is unverified scope.`
        : `Required field '${key}' is empty or missing.`,
      remediation: `Fill pilot_profile.${key} in blueprint.yml. See template/docs/methodology/pilot-profile-template.md § ${key}.`,
      reference: 'pilot-profile-lock-reviewer.md#2-every-required-field-is-non-empty',
    });
  }

  const slug = scalarOf(fields, 'slug') || 'missing';
  const displayName = scalarOf(fields, 'display_name') || 'missing';

  // §3 — walkthrough_citation resolves to a real file (the load-bearing field).
  const citation = scalarOf(fields, 'walkthrough_citation');
  let citationResolved = false;
  if (citation !== '') {
    // Resolve relative to the initiative root; tolerate an already-absolute path.
    const candidate = path.isAbsolute(citation) ? citation : path.join(targetDir, citation);
    try {
      citationResolved = existsSync(candidate);
    } catch {
      citationResolved = false;
    }
    if (!citationResolved) {
      findings.push({
        severity: 'BLOCK',
        location: 'blueprint.yml pilot_profile.walkthrough_citation',
        message: `walkthrough_citation '${citation}' does not resolve to an existing file. The pilot must be grounded in a real artifact (interview transcript, competitive walkthrough, observation notes, screenshot set) — not imagined research.`,
        remediation: `Point walkthrough_citation at a real committed artifact path (relative to the initiative root), or create the artifact. Checked: ${path.relative(targetDir, candidate) || candidate}.`,
        reference: 'pilot-profile-lock-reviewer.md#3-walkthrough_citation-resolves-to-a-real-file',
      });
    }
  } // (empty citation already blocked by §2)

  // §5 (mechanical slice) — monetization_side generic-value WARN. Membership in
  // the generic list is the only mechanical test; whether generic is genuinely
  // wrong is agent judgment (see INFO below). Never blocks.
  const side = scalarOf(fields, 'monetization_side');
  if (side !== '' && GENERIC_SIDES.includes(side.toLowerCase())) {
    findings.push({
      severity: 'WARN',
      location: 'blueprint.yml pilot_profile.monetization_side',
      message: `monetization_side='${side}' is generic. Confirm this is genuinely a single-sided market and not a hidden multi-sided model (buyer/seller, player/coach/organizer, developer/consumer/operator).`,
      remediation: 'If the product is genuinely single-sided, leave as-is and note it. Otherwise name the specific monetizing side.',
      reference: 'pilot-profile-lock-reviewer.md#5-monetization_side-names-a-real-side-of-the-market',
    });
  }

  // §7 — pilot amendment mid-pipeline requires an ADR. Recent edit + no ADR = BLOCK.
  const edit = detectRecentPilotEdit(targetDir, 14);
  if (edit.gitAvailable && edit.recentlyEdited && !edit.adrFound) {
    findings.push({
      severity: 'BLOCK',
      location: 'blueprint.yml pilot_profile (git history, last 14 days)',
      message:
        'pilot_profile: was edited in the last 14 days but no corresponding ADR exists in decisions/ or blueprint/decisions/. Pilot amendments are legitimate but silent ones are the failure mode this gate prevents.',
      remediation:
        'Write an ADR (decisions/NNNN-pilot-profile-*.md) naming the prior profile, the disqualifier that triggered the change, and which downstream Stage 1/2 artifacts need re-evaluation.',
      reference: 'pilot-profile-lock-reviewer.md#7-adr-check-for-pilot-amendments-mid-pipeline',
    });
  } else if (!edit.gitAvailable) {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml pilot_profile (git history)',
      message: 'Could not run git history check for a recent pilot_profile edit (not a git repo or git unavailable). The §7 ADR-on-amendment check was skipped — verify manually if the pilot was recently changed.',
      remediation: 'Run inside the initiative git repo to enable the recent-edit ADR check.',
      reference: 'pilot-profile-lock-reviewer.md#7-adr-check-for-pilot-amendments-mid-pipeline',
    });
  }

  // ── INFO findings: judgment-only criteria. NOT faked, NOT blocking. ──────────
  // These three .md checks require agent judgment the mechanical reviewer cannot
  // honestly perform. They are surfaced so the agent running the full .md spec
  // knows to evaluate them; they NEVER drive BLOCKED.
  const painPoint = scalarOf(fields, 'pain_point');
  if (painPoint !== '') {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml pilot_profile.pain_point',
      message: `pain_point specificity is agent-verified (see .md spec §4): judge whether "${painPoint.length > 120 ? painPoint.slice(0, 117) + '...' : painPoint}" names a concrete actor + failure mode (strong) vs a single noun / generic outcome / marketing prose (weak). Concreteness, not length, is the test. This mechanical reviewer does not block on it.`,
      remediation: 'Agent: apply the §4 smell-test. If weak, BLOCK per the .md spec and request a concrete rewrite.',
      reference: 'pilot-profile-lock-reviewer.md#4-pain_point-passes-the-specificity-smell-test',
    });
  }
  const competitors = listOf(fields, 'competitors_in_scope');
  if (competitors.length > 0) {
    findings.push({
      severity: 'INFO',
      location: 'blueprint.yml pilot_profile.competitors_in_scope',
      message: `competitors-grounded-in-citation is agent-verified (see .md spec §6): read the walkthrough_citation and judge whether each of [${competitors.join(', ')}] is mentioned/compared there (pilot-derived) vs a "vibes" pick. Unmentioned competitors WARN per the .md; this mechanical reviewer cannot read the citation's semantics and does not evaluate it.`,
      remediation: 'Agent: open the citation, cross-check each competitor, WARN on any that are unmentioned.',
      reference: 'pilot-profile-lock-reviewer.md#6-competitors_in_scope-are-derived-from-the-pilot',
    });
  }

  const blocked = findings.filter((f) => f.severity === 'BLOCK').length;
  const summary =
    `pilot=${slug}/${displayName}, fields ${filledCount}/${REQUIRED_FIELDS.length}, ` +
    `citation=${citation === '' ? 'empty' : citationResolved ? 'resolved' : 'unresolved'}, ` +
    `recentEdit=${edit.gitAvailable ? (edit.recentlyEdited ? (edit.adrFound ? 'yes+ADR' : 'yes-noADR') : 'no') : 'n/a'}` +
    (blocked ? ` — ${blocked} BLOCK` : '');
  return finalize(findings, summary, startedAt);
}

// ── Self-test ────────────────────────────────────────────────────────────────
// `node pilot-profile-lock-reviewer.mjs` exercises the parser + the gate against
// inline fixtures and exits non-zero on the first failed assertion. Matches the
// libs' guarded-self-test pattern.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  let failures = 0;
  const assert = (cond, msg) => {
    if (!cond) {
      failures += 1;
      console.error(`  ✗ ${msg}`);
    } else {
      console.log(`  ✓ ${msg}`);
    }
  };

  const mkInit = (yml, extra = () => {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pilot-lock-'));
    writeFileSync(path.join(dir, 'blueprint.yml'), yml);
    extra(dir);
    return dir;
  };
  const cleanup = (dir) => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  // ── parser unit tests ──
  console.log('parsePilotProfile:');
  {
    const p = parsePilotProfile('pilot_profile:\n  slug: "org"\n  competitors_in_scope: [A, "B C"]\n  out_of_scope_pilots:\n    - Player\n    - Coach\nother: 1\n');
    assert(p.present === true, 'detects block presence');
    assert(p.fields.slug.value === 'org', 'scalar parsed + unquoted');
    assert(p.fields.competitors_in_scope.items.length === 2 && p.fields.competitors_in_scope.items[1] === 'B C', 'inline list w/ quoted entry → 2 items');
    assert(p.fields.out_of_scope_pilots.items.join(',') === 'Player,Coach', 'block list → 2 items');
    assert(p.fields.other === undefined, 'stops at dedent to new top-level key');
  }
  {
    const p = parsePilotProfile('foo: bar\n');
    assert(p.present === false, 'absent block → present:false');
  }
  {
    const p = parsePilotProfile('pilot_profile:\n  slug: ""   # comment\n  display_name:\n  competitors_in_scope: []\n');
    assert(fieldFilled(p.fields.slug) === false, 'empty quoted scalar → not filled');
    assert(fieldFilled(p.fields.display_name) === false, 'empty scalar (no value) → not filled');
    assert(fieldFilled(p.fields.competitors_in_scope) === false, 'empty inline list → not filled');
  }

  // ── gate: fully-populated pilot with a real citation ──
  console.log('review() — happy path:');
  {
    const dir = mkInit(
      'pilot_profile:\n' +
      '  slug: "tournament-organizer"\n' +
      '  display_name: "Tournament Organizer"\n' +
      '  pain_point: "Organizers manually re-enter rosters from email PDFs into the bracket builder each event."\n' +
      '  monetization_side: organizer\n' +
      '  walkthrough_citation: "research/walkthrough.md"\n' +
      '  competitors_in_scope: ["VolleyballLife", "AdvancedEventSystems"]\n' +
      '  out_of_scope_pilots: ["Player searching for team"]\n',
      (d) => { mkdirSync(path.join(d, 'research')); writeFileSync(path.join(d, 'research', 'walkthrough.md'), '# walkthrough\n'); }
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'PASS', `fully-populated + resolved citation → PASS (got ${r.status})`);
    assert(r.findings.every((f) => f.severity !== 'BLOCK'), 'no BLOCK findings on happy path');
    assert(r.findings.some((f) => f.severity === 'INFO' && /pain_point/.test(f.location)), 'emits pain_point INFO (judgment-only, not faked)');
    assert(r.metadata.reviewer === NAME, 'metadata.reviewer set');
    cleanup(dir);
  }

  // ── gate: empty required fields block ──
  console.log('review() — empty fields BLOCK:');
  {
    const dir = mkInit(
      'pilot_profile:\n' +
      '  slug: ""\n' +
      '  display_name: ""\n' +
      '  pain_point: ""\n' +
      '  monetization_side: ""\n' +
      '  walkthrough_citation: ""\n' +
      '  competitors_in_scope: []\n' +
      '  out_of_scope_pilots: []\n'
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `all-empty → BLOCKED (got ${r.status})`);
    const blockFields = r.findings.filter((f) => f.severity === 'BLOCK').length;
    assert(blockFields === 7, `one BLOCK per empty required field (got ${blockFields})`);
    cleanup(dir);
  }

  // ── gate: unresolved citation blocks even when other fields filled ──
  console.log('review() — unresolved citation BLOCK:');
  {
    const dir = mkInit(
      'pilot_profile:\n' +
      '  slug: org\n' +
      '  display_name: Org\n' +
      '  pain_point: "Concrete actor does concrete failing thing."\n' +
      '  monetization_side: organizer\n' +
      '  walkthrough_citation: "research/missing.md"\n' +
      '  competitors_in_scope: [A]\n' +
      '  out_of_scope_pilots: [B]\n'
    );
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `missing citation file → BLOCKED (got ${r.status})`);
    assert(r.findings.some((f) => f.severity === 'BLOCK' && /walkthrough_citation/.test(f.location)), 'citation BLOCK present');
    cleanup(dir);
  }

  // ── gate: missing pilot_profile block ──
  console.log('review() — missing block BLOCK:');
  {
    const dir = mkInit('variant: greenfield\n');
    const r = await review({ targetDir: dir });
    assert(r.status === 'BLOCKED', `no pilot_profile block → BLOCKED (got ${r.status})`);
    assert(r.findings.length === 1 && /No `pilot_profile:`/.test(r.findings[0].message), 'single missing-block finding');
    cleanup(dir);
  }

  // ── gate: not a Blueprint initiative ──
  console.log('review() — no blueprint.yml PASS:');
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pilot-lock-empty-'));
    const r = await review({ targetDir: dir });
    assert(r.status === 'PASS', `no blueprint.yml → PASS (got ${r.status})`);
    cleanup(dir);
  }

  // ── gate: generic monetization_side WARNs but does not block ──
  console.log('review() — generic monetization_side WARN:');
  {
    const dir = mkInit(
      'pilot_profile:\n' +
      '  slug: org\n' +
      '  display_name: Org\n' +
      '  pain_point: "Concrete actor does concrete failing thing."\n' +
      '  monetization_side: user\n' +
      '  walkthrough_citation: "wk.md"\n' +
      '  competitors_in_scope: [A]\n' +
      '  out_of_scope_pilots: [B]\n',
      (d) => writeFileSync(path.join(d, 'wk.md'), 'x')
    );
    const r = await review({ targetDir: dir });
    assert(r.findings.some((f) => f.severity === 'WARN' && /monetization_side/.test(f.location)), 'generic side → WARN finding');
    assert(r.findings.every((f) => f.severity !== 'BLOCK'), 'generic side does not BLOCK');
    assert(r.status === 'WARN', `status WARN (got ${r.status})`);
    cleanup(dir);
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
