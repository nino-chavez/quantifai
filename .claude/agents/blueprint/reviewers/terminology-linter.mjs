/**
 * terminology-linter.mjs — executable pair for the paired .md spec. The Stage 5 →
 * Stage 6 terminology gate. Implements the ADR-0002 reviewer contract so the lint
 * runs in CI / CLI / any node, outside Claude Code:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (terminology-linter.md): scan USER-FACING copy (prototype/portal HTML,
 * Pattern A portal pages under apps/portal/src — .astro/.tsx/.md — page-visible
 * JSON, docs/content deliverables, the landing index.html, and the repo-root
 * README.md) for terms outside the approved glossary + universal anti-pattern
 * jargon. Strategy/current-state panels are stakeholder-facing — different
 * audience, NOT linted (the spec is explicit). Operator-facing docs (DESIGN.md,
 * CLAUDE.md, STATE.md, subtree READMEs) are exempt by basename: insider
 * vocabulary is their working language (wave 60).
 *
 *   - Any VIOLATION  -> BLOCKED. The spec: "If VIOLATIONS > 0, STATUS=BLOCKED."
 *   - Missing glossary (initiative > 3 days old, inferred from git/mtime) -> a
 *     WARN finding; the universal rules still run (degrade gracefully, per spec).
 *
 * Each finding carries `remediation` (the suggested replacement) so an agent can
 * find-replace directly. Dependency-free node ESM. NEVER throws — risky reads
 * degrade to a WARN/BLOCK finding.
 *
 * HONEST SCOPE: this is a mechanical lexical lint, not semantic NLP.
 *   - Term matching is word-boundary regex over text-extracted content (HTML tags
 *     stripped, JSON string values + keys flattened). No grammar/sense
 *     disambiguation — "schema" in prose and "schema" in a code sample both hit.
 *   - The glossary is parsed by a simple line-scan (Markdown table rows OR bullet
 *     list OR the DESIGN.md "User terminology" section). No nested-YAML parsing.
 *   - "Acronym defined on first use" is a heuristic: an acronym is treated as
 *     defined if an expansion appears within ~60 chars of, or in parentheses
 *     adjacent to, its first occurrence on the SAME page. Genuine prose-distance
 *     definitions can be missed (WARN, not BLOCK) — we never block on the acronym
 *     heuristic alone, only on the hard anti-pattern / glossary-conflict terms.
 *   - "Cross-check used terms against glossary" is NOT implemented as a closed
 *     vocabulary (flagging every word absent from the glossary is uselessly
 *     noisy). The glossary is used in the direction the spec actually needs:
 *     a glossary CONFLICT term (a canonical replacement's banned synonym) is
 *     BLOCKED. SAID SO here so the check is not over-claimed.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'terminology-linter';

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);
const exists = (p) => fs.access(p).then(() => true, () => false);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

function finalize(findings, targetSummary, startedAt) {
  // Spec: any violation → BLOCKED. WARN-only findings (missing glossary,
  // undefined-acronym heuristic) do not block.
  const status = findings.some((f) => f.severity === 'BLOCK')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'WARN')
    ? 'WARN'
    : 'PASS';
  return result(status, findings, targetSummary, startedAt);
}

// --- file discovery -------------------------------------------------------

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.astro', '.git', '_meta-internal']);

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) await walk(fp, acc);
    } else {
      acc.push(fp);
    }
  }
  return acc;
}

// Strategy / current-state panels are stakeholder-facing — the spec says do NOT
// lint them. Heuristic: filename or path segment names a strategy/current-state
// surface. Kept conservative so we don't silently exempt real user copy.
function isStakeholderFacing(relPath) {
  const lower = relPath.toLowerCase();
  return (
    /(^|\/)strategy(\/|[-.])/.test(lower) ||
    /(^|\/)current-state(\/|[-.])/.test(lower) ||
    /strategy-panel|current-state-panel|stakeholder/.test(lower)
  );
}

// --- text extraction ------------------------------------------------------

// Strip HTML to visible text: drop <script>/<style> bodies, drop tags, decode a
// few common entities. Good enough for lexical term-matching; not a parser.
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Flatten a JSON file's page-visible strings (keys + string values) to a text
// blob. Non-JSON / malformed input degrades to '' (caller never throws).
export function jsonToText(raw) {
  if (!raw) return '';
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return '';
  }
  const out = [];
  const walkVal = (v, key) => {
    if (key != null) out.push(String(key));
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walkVal(x, null));
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walkVal(val, k);
  };
  walkVal(obj, null);
  return out.join(' ');
}

// Strip Markdown to visible prose. Frontmatter, fenced code blocks, inline code,
// and link/image URLs are not user-facing copy — linting them produces false
// positives ('schema' inside a YAML fence). Link labels are kept; remaining
// inline HTML rides through htmlToText.
export function mdToText(md) {
  if (!md) return '';
  return htmlToText(
    md
      .replace(/^---\n[\s\S]*?\n---\n/, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]*`/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  );
}

export function extractText(relPath, raw) {
  if (/\.html?$/i.test(relPath)) return htmlToText(raw);
  if (/\.json$/i.test(relPath)) return jsonToText(raw);
  if (/\.md$/i.test(relPath)) return mdToText(raw);
  // .astro / .tsx — strip JSX/HTML tags too (same heuristic as HTML).
  if (/\.(astro|tsx|jsx)$/i.test(relPath)) return htmlToText(raw);
  return raw || '';
}

// --- glossary parsing -----------------------------------------------------

// Parse a glossary file into a Set of approved terms (lowercased). Supports:
//   - Markdown table rows:    | Term | Definition |
//   - Bullet lists:           - **Term** — definition   /   - Term: definition
//   - The DESIGN.md "User terminology" section (a sub-slice of the above forms).
// Returns { terms:Set<string>, count:number }. Never throws.
export function parseGlossary(raw, { section } = {}) {
  const terms = new Set();
  if (!raw) return { terms, count: 0 };

  let body = raw;
  if (section) {
    // Slice from the named heading to the next same-or-higher heading.
    const lines = raw.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+.*${section}`, 'i').test(l));
    if (start >= 0) {
      const startLevel = (lines[start].match(/^#+/) || ['#'])[0].length;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s/);
        if (m && m[1].length <= startLevel) { end = i; break; }
      }
      body = lines.slice(start + 1, end).join('\n');
    } else {
      return { terms, count: 0 }; // section not present
    }
  }

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Markdown table row: | Term | ... |  (skip header separators like |---|---|)
    if (/^\|/.test(trimmed) && !/^\|[\s:|-]+\|?\s*$/.test(trimmed)) {
      const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length) {
        const t = cells[0].replace(/^\*+|\*+$/g, '').replace(/`/g, '').trim();
        if (t && !/^(term|name|word)$/i.test(t)) terms.add(t.toLowerCase());
      }
      continue;
    }

    // Bullet list: - **Term** — def  |  * Term: def  |  - `Term` ...
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      const head = bullet[1]
        .replace(/`/g, '')
        .split(/—|–|-{1,2}\s|:\s/)[0] // term is before the dash/colon separator
        .replace(/\*+/g, '')
        .trim();
      if (head) terms.add(head.toLowerCase());
    }
  }
  return { terms, count: terms.size };
}

// --- universal anti-pattern rules -----------------------------------------

// Engineering jargon that should not leak into customer-facing copy unless the
// product is itself a developer tool (then 'endpoint'/'schema'/'payload' are
// legitimate domain vocabulary — gated by isDevTool).
const ENGINEERING_JARGON = [
  { term: 'schema', suggest: "plain-language term for the data shape (e.g. 'fields' / 'structure')" },
  { term: 'payload', suggest: "plain-language term (e.g. 'the data sent' / 'request body')" },
  { term: 'endpoint', suggest: "plain-language term (e.g. 'API URL' / 'service address') — gated: allowed for dev-tool products" },
];

// Deprecated methodology-internal labels (wave 72). "Pattern A" and "Pattern B"
// are methodology jargon; their user-facing names are "Initiative Portal" and
// "Review Portal". Flag these if they surface in user-facing copy.
const DEPRECATED_PORTAL_LABELS = [
  { re: /\bPattern\s+A\b/, term: 'Pattern A', suggest: "use 'Initiative Portal' (wave 72 rename)" },
  { re: /\bPattern\s+B\b/, term: 'Pattern B', suggest: "use 'Review Portal' (wave 72 rename)" },
];

// Brand anti-pattern: 'deflect'/'deflection' in support copy.
const DEFLECTION_RULE = {
  re: /\bdeflect(?:ion|ions|ed|ing|s)?\b/i,
  term: 'deflection',
  suggest: "use 'self-service resolution' or 'resolve without support'",
};

// B2B Edition canonical-vocabulary rules (only when b2b_edition.enabled).
const B2B_RULES = [
  { re: /\bcustomers?\b/i, term: 'Customer', suggest: "use 'Buyer' in B2B-specific copy" },
  { re: /\bRFQs?\b/, term: 'RFQ', suggest: "use 'Quote' in user-facing copy" },
  { re: /\baccounts?\b/i, term: 'Account', suggest: "use 'Company' when referring to the B2B parent entity" },
];

// Find the first match of a word-boundary term in text, returning a 1-based
// "line" derived from the original raw (best-effort) or null if absent.
function firstHit(re, text) {
  return re.test(text);
}

// Undefined-acronym heuristic. An ALL-CAPS token (2+ letters) is "defined" if an
// expansion sits adjacent: "API (Application Programming Interface)" or
// "Application Programming Interface (API)". WARN only — never blocks.
const ACRONYM_ALLOW = new Set([
  'OK', 'ID', 'URL', 'FAQ', 'PDF', 'CSV', 'JSON', 'HTML', 'CSS', 'US', 'UK', 'EU',
  'AM', 'PM', 'CEO', 'CTO', 'B2B', 'B2C', 'SKU', 'USD',
  // Universally-understood dev/product terms — added when .md scanning landed
  // (wave 60) so prose docs don't WARN-spam. Deliberately NOT allow-listed:
  // ADR, BRD, PRD — those are exactly the define-on-first-use class.
  'API', 'CLI', 'SDK', 'AI', 'UI', 'UX', 'MIT', 'YAML', 'README', 'HTTP', 'HTTPS', 'NPM',
]);
export function undefinedAcronyms(text) {
  const found = new Map(); // acronym -> defined?
  const re = /\b([A-Z]{2,})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ac = m[1];
    if (ACRONYM_ALLOW.has(ac)) continue;
    if (found.has(ac) && found.get(ac)) continue; // already seen + defined
    // Look at a window around this first occurrence for an adjacent expansion.
    const around = text.slice(Math.max(0, m.index - 80), m.index + ac.length + 80);
    // paren-adjacent: "ACR (Some Words)" or "Some Words (ACR)"
    const parenAfter = new RegExp(`\\b${ac}\\b\\s*\\([^)]{3,}\\)`).test(around);
    const parenBefore = new RegExp(`\\([^)]*\\b${ac}\\b[^)]*\\)`).test(around);
    // initialism: the letters of ac begin nearby Capitalized words
    const initialism = (() => {
      const words = around.match(/\b[A-Z][a-z]+\b/g) || [];
      const initials = words.map((w) => w[0]).join('');
      return initials.toUpperCase().includes(ac);
    })();
    const defined = parenAfter || parenBefore || initialism;
    if (!found.has(ac)) found.set(ac, defined);
    else if (defined) found.set(ac, true);
  }
  return [...found.entries()].filter(([, def]) => !def).map(([ac]) => ac);
}

// --- glossary location ----------------------------------------------------

async function locateGlossary(targetDir) {
  // 1. docs/terminology.md
  const termFile = path.join(targetDir, 'docs', 'terminology.md');
  if (await exists(termFile)) {
    const raw = await read(termFile);
    const g = parseGlossary(raw);
    return { file: 'docs/terminology.md', ...g, raw };
  }
  // 2. prototype/DESIGN.md "User terminology" section
  const designFile = path.join(targetDir, 'prototype', 'DESIGN.md');
  if (await exists(designFile)) {
    const raw = await read(designFile);
    const g = parseGlossary(raw, { section: 'User terminology' });
    if (g.count > 0) return { file: 'prototype/DESIGN.md (User terminology)', ...g, raw };
  }
  return { file: null, terms: new Set(), count: 0, raw: null };
}

// Estimate initiative age in days from blueprint.yml timestamps (proxy for
// "running for more than 3 days"). HONEST SCOPE: filesystems disagree on
// birthtime support, so we take the OLDEST of birthtime/ctime/mtime as the
// best available "first existed" signal. A git-clone resets these — when a
// freshly-cloned repo reports < 3 days we simply don't yet emit the
// missing-glossary WARN (we under-warn rather than false-positive). Returns
// null if unavailable.
async function initiativeAgeDays(targetDir) {
  try {
    const st = await fs.stat(path.join(targetDir, 'blueprint.yml'));
    const oldest = Math.min(
      st.birthtimeMs || Infinity,
      st.ctimeMs || Infinity,
      st.mtimeMs || Infinity
    );
    if (!isFinite(oldest)) return null;
    return (Date.now() - oldest) / 86_400_000;
  } catch {
    return null;
  }
}

// --- blueprint.yml fallback (dependency-free line-scan) ---------------------

// Doctor and the CLI dispatcher pass blueprintYml: null, so the fields this
// linter gates on (product_type, terminology.glossary, b2b_edition.enabled)
// are read from targetDir/blueprint.yml directly when the parsed object lacks
// them (wave 77 — before this, isDevTool never fired outside a caller that
// parsed yaml, and dev-tool repos got jargon BLOCKs on their own vocabulary).
async function readYmlFields(targetDir) {
  const out = {};
  let raw;
  try { raw = await read(path.join(targetDir, 'blueprint.yml')); } catch { return out; }
  if (raw == null) return out; // read() resolves null on a missing file rather than throwing
  let section = null;
  for (const line of raw.split('\n')) {
    const top = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*(#.*)?$/);  // digits: b2b_edition
    if (top) {
      section = top[1];
      if (top[1] === 'product_type' && top[2]) out.product_type = top[2].replace(/^["']|["']$/g, '');
      continue;
    }
    if (/^\S/.test(line)) { section = null; continue; }
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    const v = (kv[2] || '').replace(/^["']|["']$/g, '');
    if (section === 'terminology' && kv[1] === 'glossary' && v) out.terminology = { glossary: v };
    if (section === 'b2b_edition' && kv[1] === 'enabled') out.b2b_edition = { enabled: v === 'true' };
  }
  return out;
}

// --- jurisdiction (wave 77) -------------------------------------------------

// The scanned-set declaration the doctor's lint-jurisdiction check diffs
// against the tree's actual prose surfaces. Keep in sync with the roots list
// inside review() — this export IS the honest-scope statement.
export const jurisdiction = {
  description: 'user-facing copy (deprecated labels, jargon, glossary conflicts, acronyms)',
  roots: ['prototype', 'portal', 'apps/portal/src', '_meta', 'docs/content'],
  rootFiles: ['README.md', 'index.html'],
  extensions: null, // all reader-facing file types under the roots
  excludes: [],
};

// --- main -----------------------------------------------------------------

// Build the set of glossary-conflict BLOCK rules. The spec's "conflict with the
// existing product's vocabulary" reduces, mechanically, to: if the glossary
// declares a canonical term whose banned synonym we can recognize, flag the
// synonym. We only encode the synonym pairs the spec itself names (deflection,
// B2B). Glossary parsing still drives the missing-glossary + age findings and
// keeps the door open for a richer pairs map without changing the contract.
export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // Effective config: parsed object wins; blueprint.yml line-scan fills the
  // gaps (doctor and the CLI dispatcher pass blueprintYml: null).
  const yml = { ...(await readYmlFields(targetDir)), ...(blueprintYml || {}) };

  // Is the product a developer tool? Then 'endpoint'/'schema'/'payload' are
  // legitimate domain vocabulary.
  const isDevTool = (() => {
    const hay = JSON.stringify(yml).toLowerCase();
    return /dev[- ]?tool|developer[- ]?tool|api|sdk|cli/.test(
      String(yml.product_type || yml.productType || yml.category || '').toLowerCase()
    ) || /"product_type"\s*:\s*"[^"]*(dev|api|sdk|cli)/.test(hay);
  })();

  // B2B Edition flag (parsed object: b2b_edition.enabled).
  const b2bEnabled = (() => {
    const b = yml.b2b_edition || yml.b2bEdition;
    return !!(b && (b.enabled === true || b.enabled === 'true'));
  })();

  // No-glossary repo (terminology.glossary: none): jargon is handled by
  // copy rewrites or define-on-first-use inline, never a glossary artifact.
  // The missing-glossary WARN retires instead of nagging on every run;
  // glossary-conflict checks are vacuous anyway with no glossary to conflict.
  const glossaryDeclaredNone =
    String((yml.terminology && yml.terminology.glossary) || '').toLowerCase() === 'none';

  // 1. Locate glossary.
  let glossary;
  try {
    glossary = await locateGlossary(targetDir);
  } catch {
    glossary = { file: null, terms: new Set(), count: 0, raw: null };
  }

  if (!glossaryDeclaredNone && (!glossary.file || glossary.count === 0)) {
    const ageDays = await initiativeAgeDays(targetDir);
    const oldEnough = ageDays == null ? true : ageDays > 3;
    if (oldEnough) {
      findings.push({
        severity: 'WARN',
        location: 'docs/terminology.md',
        message:
          'No glossary found (docs/terminology.md absent and prototype/DESIGN.md has no "User terminology" section). ' +
          'Universal rules (deflection, jargon, B2B, acronyms) still ran, but glossary-conflict checks could not.',
        remediation:
          'Create docs/terminology.md (Markdown table: | Term | Definition |) or add a "## User terminology" section to prototype/DESIGN.md, ' +
          'grounded in the existing product vocabulary (research/current-state/).',
        reference: 'terminology-linter.md#1-locate-the-glossary',
      });
    }
  }

  // 2. Discover user-facing files.
  const roots = [
    path.join(targetDir, 'prototype'),
    path.join(targetDir, 'portal'),
    path.join(targetDir, 'apps', 'portal', 'src'),
    path.join(targetDir, '_meta'),
    path.join(targetDir, 'docs', 'content'),
  ];
  const candidates = [];
  for (const r of roots) {
    if (await exists(r)) candidates.push(...(await walk(r)));
  }
  // Landing page + public README at root. The repo-root README is the public
  // entry point (npm/GitHub) — reader-facing copy, in scope since wave 60.
  const rootIndex = path.join(targetDir, 'index.html');
  if (await exists(rootIndex)) candidates.push(rootIndex);
  const rootReadme = path.join(targetDir, 'README.md');
  if (await exists(rootReadme)) candidates.push(rootReadme);

  // Operator-facing docs are exempt by basename: insider vocabulary is their
  // working language. Applies inside scanned subtrees only — the ROOT README
  // (rel === 'README.md') stays in scope.
  const OPERATOR_DOC_BASENAMES = new Set([
    'DESIGN.md', 'CLAUDE.md', 'STATE.md', 'README.md',
    'HANDOFF.md', 'METHODOLOGY-AMENDMENTS.md', 'WAVE-LOG.md',
  ]);

  const userFacing = candidates.filter((f) => {
    const rel = path.relative(targetDir, f);
    if (isStakeholderFacing(rel)) return false; // strategy/current-state — not linted
    if (rel !== 'README.md' && OPERATOR_DOC_BASENAMES.has(path.basename(f))) return false;
    return /\.(html?|json|astro|tsx|jsx|md)$/i.test(f);
  });

  // 3. Lint each file. De-duplicate violations per file (each term once per file).
  let scanned = 0;
  let violations = 0;
  for (const file of userFacing) {
    const rel = path.relative(targetDir, file);
    let raw;
    try {
      raw = await read(file);
    } catch {
      findings.push({
        severity: 'WARN',
        location: rel,
        message: 'Could not read file for terminology lint — skipped.',
        remediation: 'Check file permissions / encoding.',
        reference: 'terminology-linter.md',
      });
      continue;
    }
    if (raw == null) continue;
    const text = extractText(rel, raw);
    if (!text) { scanned += 1; continue; }
    scanned += 1;

    const seenTerms = new Set(); // per-file de-dup

    // 3a. Deflection (universal — support-copy anti-pattern).
    if (firstHit(DEFLECTION_RULE.re, text) && !seenTerms.has(DEFLECTION_RULE.term)) {
      seenTerms.add(DEFLECTION_RULE.term);
      violations += 1;
      findings.push({
        severity: 'BLOCK',
        location: rel,
        message: `Anti-pattern term '${DEFLECTION_RULE.term}' in user-facing copy.`,
        remediation: DEFLECTION_RULE.suggest,
        reference: 'terminology-linter.md#3-brand-anti-pattern-terms',
      });
    }

    // 3b. Engineering jargon (gated by isDevTool for the gateable ones).
    for (const j of ENGINEERING_JARGON) {
      const gated = j.term === 'endpoint' || j.term === 'schema' || j.term === 'payload';
      if (gated && isDevTool) continue; // legitimate domain vocabulary
      const re = new RegExp(`\\b${j.term}\\b`, 'i');
      if (firstHit(re, text) && !seenTerms.has(j.term)) {
        seenTerms.add(j.term);
        violations += 1;
        findings.push({
          severity: 'BLOCK',
          location: rel,
          message: `Engineering jargon '${j.term}' in customer-facing copy.`,
          remediation: j.suggest,
          reference: 'terminology-linter.md#3-engineering-jargon',
        });
      }
    }

    // 3c. Deprecated methodology portal labels (wave 72).
    for (const d of DEPRECATED_PORTAL_LABELS) {
      if (firstHit(d.re, text) && !seenTerms.has(d.term)) {
        seenTerms.add(d.term);
        violations += 1;
        findings.push({
          severity: 'BLOCK',
          location: rel,
          message: `Deprecated methodology term '${d.term}' in user-facing copy.`,
          remediation: d.suggest,
          reference: 'terminology-linter.md#deprecated-portal-labels',
        });
      }
    }

    // 3d. B2B Edition canonical-vocabulary rules.
    if (b2bEnabled) {
      for (const b of B2B_RULES) {
        if (firstHit(b.re, text) && !seenTerms.has(b.term)) {
          seenTerms.add(b.term);
          violations += 1;
          findings.push({
            severity: 'BLOCK',
            location: rel,
            message: `B2B Edition vocabulary violation: '${b.term}' should not appear in user-facing copy.`,
            remediation: b.suggest,
            reference: 'terminology-linter.md#4-bc-b2b-edition',
          });
        }
      }
    }

    // 3d. Undefined acronyms (WARN-only heuristic — never blocks).
    const undefAcs = undefinedAcronyms(text);
    for (const ac of undefAcs.slice(0, 5)) {
      const key = `acronym:${ac}`;
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      findings.push({
        severity: 'WARN',
        location: rel,
        message: `Acronym '${ac}' appears without a nearby definition on first use (heuristic — may be a false positive).`,
        remediation: `Expand '${ac}' on first use, e.g. "${ac} (full expansion)", or add it to the glossary if it is established product vocabulary.`,
        reference: 'terminology-linter.md#3-acronyms-not-defined-on-first-use',
      });
    }
  }

  const summary =
    `glossary=${glossaryDeclaredNone ? 'declared-none' : `${glossary.file || 'missing'} (${glossary.count} terms)`}, ` +
    `files=${scanned}, violations=${violations}` +
    (b2bEnabled ? ', b2b=on' : '') +
    (isDevTool ? ', dev-tool=on' : '');
  return finalize(findings, summary, startedAt);
}

// --------------------------------------------------------------------------
// Self-test — `node terminology-linter.mjs` exercises the lint against inline
// fixtures and exits non-zero on any failed assertion (matches the libs' pattern).
// --------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`ok: ${msg}`);
    }
  };

  // -- pure helpers --------------------------------------------------------
  assert(
    htmlToText('<div>Hello <script>var x=1</script><b>world</b></div>') === 'Hello world',
    'htmlToText strips tags + script bodies'
  );
  assert(
    jsonToText('{"title":"Resolve without support","nested":{"k":"payload"}}').includes('payload'),
    'jsonToText flattens nested string values'
  );
  assert(jsonToText('not json at all') === '', 'jsonToText degrades malformed JSON to empty');
  assert(extractText('a.json', '{"a":"b"}').includes('b'), 'extractText routes .json');
  assert(extractText('a.html', '<p>hi</p>') === 'hi', 'extractText routes .html');

  // -- glossary parsing ----------------------------------------------------
  const gTable = parseGlossary('| Term | Definition |\n|---|---|\n| Buyer | a B2B purchaser |\n| Quote | a priced offer |');
  assert(gTable.terms.has('buyer') && gTable.terms.has('quote'), 'parseGlossary reads markdown table rows');
  assert(!gTable.terms.has('term'), 'parseGlossary skips the table header');
  const gBullet = parseGlossary('- **Buyer** — a B2B purchaser\n- Quote: a priced offer');
  assert(gBullet.terms.has('buyer') && gBullet.terms.has('quote'), 'parseGlossary reads bullet lists');
  const gSection = parseGlossary(
    '# Design\n## User terminology\n- **Resolve** — close a ticket\n## Other\n- **Ignore** — nope',
    { section: 'User terminology' }
  );
  assert(gSection.terms.has('resolve') && !gSection.terms.has('ignore'), 'parseGlossary slices the named section only');

  // -- acronym heuristic ---------------------------------------------------
  assert(
    undefinedAcronyms('The XYZ system is great. The XYZ system again.').includes('XYZ'),
    'undefinedAcronyms flags an undefined acronym'
  );
  assert(
    !undefinedAcronyms('The XYZ (Extra Young Zebra) system.').includes('XYZ'),
    'undefinedAcronyms treats paren-adjacent expansion as defined'
  );
  assert(!undefinedAcronyms('Click OK to continue.').includes('OK'),
    'undefinedAcronyms allow-lists common acronyms');

  // -- end-to-end review() over a temp fixture tree ------------------------
  const os = await import('node:os');
  const fsp = (await import('node:fs')).promises;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'termlint-'));

  // a clean user-facing page + a dirty one + a stakeholder strategy panel.
  await fsp.mkdir(path.join(tmp, 'prototype'), { recursive: true });
  await fsp.writeFile(path.join(tmp, 'prototype', 'home.html'),
    '<html><body><h1>Resolve your issue fast</h1></body></html>');
  await fsp.writeFile(path.join(tmp, 'prototype', 'support.html'),
    '<html><body><p>We deflect tickets and expose a schema endpoint.</p></body></html>');
  await fsp.writeFile(path.join(tmp, 'prototype', 'strategy-panel.html'),
    '<html><body><p>Our deflection schema strategy.</p></body></html>'); // NOT linted
  await fsp.writeFile(path.join(tmp, 'blueprint.yml'), 'variant: greenfield\ntier: 1\n');

  const res = await review({ targetDir: tmp, blueprintYml: { variant: 'greenfield' } });
  assert(res.status === 'BLOCKED', 'review BLOCKS when a user page uses deflection/schema/endpoint');
  const supportBlocks = res.findings.filter((f) => f.location === 'prototype/support.html' && f.severity === 'BLOCK');
  assert(supportBlocks.some((f) => /deflection/.test(f.message)), 'flags deflection in support.html');
  assert(supportBlocks.some((f) => /schema/.test(f.message)), 'flags schema in support.html');
  assert(supportBlocks.some((f) => /endpoint/.test(f.message)), 'flags endpoint in support.html');
  // strategy panel must NOT contribute findings.
  assert(
    !res.findings.some((f) => f.location === 'prototype/strategy-panel.html'),
    'strategy panel is exempt from the lint'
  );
  // per-file de-dup: deflection flagged at most once for support.html.
  assert(
    supportBlocks.filter((f) => /deflection/.test(f.message)).length === 1,
    'deflection de-duplicated to one finding per file'
  );
  assert(res.metadata.reviewer === NAME, 'metadata carries the reviewer name');

  // dev-tool gating: schema/endpoint allowed when product is a dev tool.
  const devRes = await review({
    targetDir: tmp,
    blueprintYml: { product_type: 'dev-tool' },
  });
  const devSupport = devRes.findings.filter((f) => f.location === 'prototype/support.html' && f.severity === 'BLOCK');
  assert(!devSupport.some((f) => /schema|endpoint/.test(f.message)), 'dev-tool gates schema/endpoint jargon');
  assert(devSupport.some((f) => /deflection/.test(f.message)), 'deflection still blocks for dev tools');

  // B2B rules: Customer/RFQ/Account block only when b2b_edition.enabled.
  await fsp.writeFile(path.join(tmp, 'prototype', 'b2b.html'),
    '<html><body><p>Welcome Customer, submit an RFQ for your Account.</p></body></html>');
  const noB2b = await review({ targetDir: tmp, blueprintYml: {} });
  assert(
    !noB2b.findings.some((f) => f.location === 'prototype/b2b.html' && /B2B Edition/.test(f.message)),
    'B2B rules silent when b2b_edition disabled'
  );
  const yesB2b = await review({ targetDir: tmp, blueprintYml: { b2b_edition: { enabled: true } } });
  const b2bFinds = yesB2b.findings.filter((f) => f.location === 'prototype/b2b.html' && /B2B Edition/.test(f.message));
  assert(b2bFinds.some((f) => /Customer/.test(f.message)), 'B2B flags Customer→Buyer');
  assert(b2bFinds.some((f) => /RFQ/.test(f.message)), 'B2B flags RFQ→Quote');
  assert(b2bFinds.some((f) => /Account/.test(f.message)), 'B2B flags Account→Company');

  // missing-glossary WARN is AGE-GATED (spec: only flag if running > 3 days).
  // The fixture's blueprint.yml is brand-new, so a missing glossary is NOT yet
  // flagged — a fresh initiative legitimately has no glossary.
  assert(
    !yesB2b.findings.some((f) => /No glossary found/.test(f.message)),
    'missing glossary NOT flagged for a fresh (<3 day) initiative'
  );
  // Backdate the blueprint.yml > 3 days and re-run → the WARN appears.
  const old = new Date(Date.now() - 5 * 86_400_000);
  await fsp.utimes(path.join(tmp, 'blueprint.yml'), old, old);
  const agedRes = await review({ targetDir: tmp, blueprintYml: { b2b_edition: { enabled: true } } });
  // birthtime is not always settable via utimes on every FS; only assert when the
  // platform actually reports the backdated birthtime as > 3 days.
  const st = await fsp.stat(path.join(tmp, 'blueprint.yml'));
  const agedDays = (Date.now() - Math.min(st.birthtimeMs || Infinity, st.ctimeMs || Infinity, st.mtimeMs || Infinity)) / 86_400_000;
  if (agedDays > 3) {
    assert(
      agedRes.findings.some((f) => /No glossary found/.test(f.message) && f.severity === 'WARN'),
      'missing glossary surfaces a WARN for an aged (>3 day) initiative'
    );
  } else {
    console.log('ok: (skipped aged-glossary assertion — FS does not honor backdated birthtime)');
  }

  // -- markdown extraction + scan-set extension (wave 60) -------------------
  const mdT = mdToText(
    '---\ntitle: schema\n---\n# Heading\n```\nendpoint here\n```\nUse `payload` inline. Real deflection here. [link label](http://url/schema-path)'
  );
  assert(!/\bschema\b/.test(mdT), 'mdToText strips frontmatter + link URLs');
  assert(!/\bendpoint\b/.test(mdT), 'mdToText strips fenced code blocks');
  assert(!/\bpayload\b/.test(mdT), 'mdToText strips inline code');
  assert(/deflection/.test(mdT) && /link label/.test(mdT), 'mdToText keeps prose + link labels');

  await fsp.mkdir(path.join(tmp, 'apps', 'portal', 'src', 'pages'), { recursive: true });
  await fsp.writeFile(path.join(tmp, 'apps', 'portal', 'src', 'pages', 'learn.md'),
    '# Learn\nWe deflect tickets here.\n```\nschema endpoint payload\n```\n');
  await fsp.writeFile(path.join(tmp, 'README.md'), 'Our deflection rate is low.');
  await fsp.writeFile(path.join(tmp, 'prototype', 'DESIGN.md'),
    'Internal design notes: deflection schema endpoint.');
  const mdRes = await review({ targetDir: tmp, blueprintYml: {} });
  assert(
    mdRes.findings.some((f) => f.location === path.join('apps', 'portal', 'src', 'pages', 'learn.md') && /deflection/.test(f.message)),
    'lints Pattern A .md pages under apps/portal/src'
  );
  assert(
    !mdRes.findings.some((f) => f.location === path.join('apps', 'portal', 'src', 'pages', 'learn.md') && /schema|endpoint|payload/.test(f.message)),
    'code fences in .md pages are not linted as copy'
  );
  assert(
    mdRes.findings.some((f) => f.location === 'README.md' && /deflection/.test(f.message)),
    'lints the repo-root README (public entry point)'
  );
  assert(
    !mdRes.findings.some((f) => f.location === path.join('prototype', 'DESIGN.md')),
    'DESIGN.md is operator-facing — exempt by basename'
  );

  // never-throws on a non-existent target dir.
  const ghost = await review({ targetDir: path.join(tmp, 'does-not-exist'), blueprintYml: {} });
  assert(ghost && (ghost.status === 'PASS' || ghost.status === 'WARN'), 'review degrades gracefully on a missing dir');

  await fsp.rm(tmp, { recursive: true, force: true });

  if (process.exitCode) console.error('\nterminology-linter self-test FAILED');
  else console.log('\nterminology-linter self-test PASSED');
}
