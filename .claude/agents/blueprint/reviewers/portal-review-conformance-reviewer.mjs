/**
 * portal-review-conformance-reviewer.mjs — executable pair for the paired
 * .md spec. Implements the ADR-0002 reviewer contract so the Review Portal portal
 * conformance gate runs outside Claude Code (CLI / CI / any node).
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (Tier 0 -> Tier 1 graduation gate for Review Portal). The most common
 * Review Portal failure mode is *drawer hollowing*: an initiative copy-stamps the
 * static portal but ships pages whose `_meta/<page-id>.json` `strategy.*` /
 * `currentState.*` fields are empty. The portal looks complete (chrome intact,
 * nav works, toggle clicks) but its load-bearing review primitives are silently
 * disabled — stakeholders open the drawers and find blanks. This reviewer
 * catches the hollow case mechanically, plus the I-2 / I-3 / I-5 invariants, the
 * comparison toggle + chat FAB wiring, the `destination` traceability field, the
 * confident-preview (not deliberation-venue) shape, and residual
 * REPLACE_FOR_PROJECT banners.
 *
 * Each finding carries a `remediation` string (Lopopolo injection pattern) so an
 * agent reading the output can act on it directly. See the paired .md for the
 * full rationale behind each of the 11 checks.
 *
 * Dependency-free node ESM. Risky reads are wrapped — the reviewer NEVER throws;
 * it degrades to a BLOCK/WARN finding instead (matches the reference reviewers).
 *
 * JSON parsing note: per the spec, only field PRESENCE + a quoted-string value
 * are needed (no nested-YAML, no deep schema validation). We JSON.parse each
 * `_meta/*.json` and on parse failure fall back to a tolerant line-scan, never
 * throwing. Drawer "emptiness" is judged by whether `strategy` / `currentState`
 * have at least one populated (non-blank, non-placeholder-only) field — this is
 * a substance heuristic, not a deep semantic check, and findings say so.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

const NAME = 'portal-review-conformance-reviewer';

// The 8 required shell files (relative to the portal dir). `pages/` and
// `_meta/index.json` are directory/file presence; the rest are top-level files.
const REQUIRED_SHELL = [
  'index.html',
  'shared.css',
  '_portal-shell.js',
  'chat-widget.js',
  'proto-nav.js',
  '_meta/index.json',
  'pages',
  'functions/api/chat.js',
];

// Provider functions that must come from _portal-shell.js / proto-nav.js, not be
// redefined per-page (I-3 single-providers-source).
const PROVIDER_FN_RE = /openStrategyDrawer|setComparisonMode|initChat/;

// View-mode markers the comparison toggle controller declares in proto-nav.js.
const VIEW_MARKER_RE = /data-view|PROPOSED|COMPARE|SHIPPED|proposed|split|shipped/g;

// Variant-shaped page names → deliberation-venue shape (not a confident preview).
const VARIANT_NAME_RE = /-(a|b|c)\.|--?variant--?|-v[0-9]+\./;

const BANNER = 'REPLACE_FOR_PROJECT';

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);
const baseId = (f) => path.basename(f).replace(/\.[^.]+$/, '');

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

// A drawer object is "populated" if it has ≥1 field whose value is a non-blank
// string (or a non-empty array/object). Placeholder template strings (the
// example.json prompts like "What design choice...?") are treated as populated —
// we cannot reliably distinguish a real sentence from a template prompt without
// over-claiming. Empties ({}, "", whitespace, null) are the mechanical fail.
function drawerPopulated(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') {
      if (v.trim() !== '') return true;
    } else if (Array.isArray(v)) {
      if (v.some((x) => (typeof x === 'string' ? x.trim() !== '' : x != null))) return true;
    } else if (v && typeof v === 'object') {
      if (Object.keys(v).length > 0) return true;
    } else if (v != null) {
      return true;
    }
  }
  return false;
}

// Tolerant parse: JSON.parse first; on failure, line-scan for the fields the
// spec actually needs (destination value, presence of strategy/currentState
// keys). Returns { ok, json, destination, hasStrategy, hasCurrentState }.
function parseMeta(text) {
  try {
    const json = JSON.parse(text);
    return {
      ok: true,
      json,
      destination: typeof json.destination === 'string' ? json.destination : null,
      hasStrategy: Object.prototype.hasOwnProperty.call(json, 'strategy'),
      hasCurrentState: Object.prototype.hasOwnProperty.call(json, 'currentState'),
    };
  } catch {
    // Fallback line-scan (per spec PARSING NOTES: grep -oE for the quoted value).
    const dm = text.match(/"destination"\s*:\s*"([^"]*)"/);
    return {
      ok: false,
      json: null,
      destination: dm ? dm[1] : null,
      hasStrategy: /"strategy"\s*:/.test(text),
      hasCurrentState: /"currentState"\s*:/.test(text),
    };
  }
}

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  // Research variant: Review Portal is a brownfield-audit surface; portal optional for research — skip.
  const _prYml = await fs.readFile(path.join(artifactsRoot, 'blueprint.yml'), 'utf8').catch(() => '');
  if (/^variant:\s*research\b/m.test(_prYml)) {
    return result('PASS', [], 'research — out of scope (Review Portal is brownfield; portal optional for research)', startedAt);
  }

  // Tier gate — Tier 0 has no portal contract (mirrors Pattern A reviewer).
  const tier = blueprintYml && (blueprintYml.tier ?? blueprintYml.Tier);
  if (tier === 0 || tier === '0') {
    return result('PASS', [], 'tier 0 — no Review Portal portal contract', startedAt);
  }

  // ── Check 1: Locate the portal (canonical path + drift fallbacks). ──────────
  const canonical = path.join(artifactsRoot, 'blueprint', 'portal');
  const driftPrototype = path.join(artifactsRoot, 'blueprint', 'prototype');
  const driftPortal = path.join(artifactsRoot, 'portal');

  let portalDir = null;
  if (await exists(canonical)) {
    portalDir = canonical;
  } else if (await exists(driftPortal)) {
    portalDir = driftPortal;
    findings.push({
      severity: 'BLOCK',
      location: 'portal/',
      message: 'Portal at non-canonical path portal/ — Review Portal canonical is blueprint/portal/.',
      remediation: 'Rename portal/ to blueprint/portal/ per docs/portal-and-tier-ladder.md, or set the path in blueprint.yml.',
      reference: 'docs/portal-and-tier-ladder.md',
    });
  } else if (await exists(driftPrototype)) {
    // Path-drift: prototype/ carrying portal-shell files means it should be portal/.
    const shellish =
      (await exists(path.join(driftPrototype, '_portal-shell.js'))) ||
      (await exists(path.join(driftPrototype, 'shared.css')));
    if (shellish) {
      portalDir = driftPrototype;
      findings.push({
        severity: 'BLOCK',
        location: 'blueprint/prototype/',
        message: 'Portal-shell files (_portal-shell.js / shared.css) found under blueprint/prototype/ — non-canonical path.',
        remediation: 'Rename to blueprint/portal/ per docs/portal-and-tier-ladder.md. prototype/ is the Tier-0 design-principles scratch surface, not the stakeholder portal.',
        reference: 'docs/portal-and-tier-ladder.md',
      });
    }
  }

  if (!portalDir) {
    findings.push({
      severity: 'BLOCK',
      location: 'blueprint/portal/',
      message: 'No blueprint/portal/ (and no path-drifted portal at portal/ or blueprint/prototype/) — initiative is still at Tier 0.',
      remediation: 'Graduate to Tier 1 by copying template/portal/ to blueprint/portal/ and populating it, or run the Review Portal copy + this reviewer to catch drift.',
      reference: 'docs/portal-and-tier-ladder.md#pattern-b',
    });
    return finalize(findings, 'no portal/', startedAt);
  }

  const rel = (p) => path.relative(targetDir, p);

  // ── Check 2: Required shell files. ─────────────────────────────────────────
  let shellPresent = 0;
  for (const f of REQUIRED_SHELL) {
    if (await exists(path.join(portalDir, f))) {
      shellPresent += 1;
    } else {
      findings.push({
        severity: 'BLOCK',
        location: `${rel(portalDir)}/${f}`,
        message: `Missing required Review Portal shell file: ${f}.`,
        remediation: `Copy ${f} from template/portal/. Missing shell files mean the portal cannot honor the Review Portal contract (chrome, chat, nav, or metadata is absent).`,
        reference: 'docs/portal-and-tier-ladder.md#pattern-b',
      });
    }
  }

  const pagesDir = path.join(portalDir, 'pages');
  const metaDir = path.join(portalDir, '_meta');

  // ── Check 3: _meta/index.json manifest — pages array with ≥2 pages. ────────
  const indexJsonPath = path.join(metaDir, 'index.json');
  let metaIndexStatus = 'missing';
  let pagesInManifest = [];
  const indexText = await read(indexJsonPath);
  if (indexText == null) {
    // Already BLOCK'd above as a missing shell file if absent; note manifest state.
    metaIndexStatus = 'missing';
  } else {
    try {
      const idx = JSON.parse(indexText);
      pagesInManifest = Array.isArray(idx.pages) ? idx.pages : [];
      metaIndexStatus = pagesInManifest.length === 0 ? 'empty' : 'present';
    } catch {
      // Fallback: count "pages" entries shallowly via line-scan (presence only).
      const m = indexText.match(/"pages"\s*:\s*\[([^\]]*)\]/);
      const inner = m ? m[1].trim() : '';
      pagesInManifest = inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
      metaIndexStatus = pagesInManifest.length === 0 ? 'empty' : 'present';
      findings.push({
        severity: 'WARN',
        location: `${rel(indexJsonPath)}`,
        message: '_meta/index.json did not parse as JSON — fell back to a shallow line-scan for the pages array (presence only, not validated).',
        remediation: 'Fix the JSON so the manifest parses cleanly. The line-scan count may be approximate.',
        reference: 'CONVENTIONS.md',
      });
    }
    if (pagesInManifest.length < 2) {
      findings.push({
        severity: 'WARN',
        location: `${rel(indexJsonPath)}`,
        message: `_meta/index.json declares ${pagesInManifest.length} page(s) — a single-page portal is a landing page, not a portal.`,
        remediation: 'Add the prototype pages this portal reviews to the pages array (≥2). Not a block; flagged so it lands as a follow-up.',
        reference: 'docs/portal-and-tier-ladder.md#pattern-b',
      });
    }
  }

  // ── Collect actual page files. ─────────────────────────────────────────────
  let pageFiles = [];
  try {
    pageFiles = (await fs.readdir(pagesDir)).filter((f) => f.endsWith('.html'));
  } catch {
    pageFiles = [];
  }
  const pageCount = pageFiles.length;

  // ── Check 4a: per-page metadata file presence. ─────────────────────────────
  let metaPresent = 0;
  for (const pf of pageFiles) {
    const id = baseId(pf);
    if (await exists(path.join(metaDir, `${id}.json`))) {
      metaPresent += 1;
    } else {
      findings.push({
        severity: 'BLOCK',
        location: `${rel(metaDir)}/${id}.json`,
        message: `Page pages/${pf} has no _meta/${id}.json — the strategy/current-state drawers have no source.`,
        remediation: `Create _meta/${id}.json with destination + strategy + currentState (see template/portal/_meta/example.json).`,
        reference: 'CONVENTIONS.md',
      });
    }
  }

  // ── Check 4b: parse each _meta/<page>.json — destination + drawer substance. ─
  // Walk every _meta/*.json except index.json and the slices/ subdir.
  let metaJsonFiles = [];
  try {
    metaJsonFiles = (await fs.readdir(metaDir))
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => path.join(metaDir, f));
  } catch {
    metaJsonFiles = [];
  }

  let emptyDrawers = 0;
  const destIssues = [];
  let drawersChecked = 0;
  for (const mf of metaJsonFiles) {
    const text = await read(mf);
    const id = baseId(mf);
    if (text == null) {
      findings.push({
        severity: 'WARN',
        location: rel(mf),
        message: `Could not read _meta/${id}.json — skipped its drawer/destination checks.`,
        remediation: 'Ensure the file is readable.',
        reference: 'CONVENTIONS.md',
      });
      continue;
    }
    const parsed = parseMeta(text);
    drawersChecked += 1;

    // destination field — required, must be exactly product | blueprint.
    if (parsed.destination == null) {
      destIssues.push(`DESTINATION_MISSING: ${id}`);
    } else if (parsed.destination !== 'product' && parsed.destination !== 'blueprint') {
      destIssues.push(`DESTINATION_INVALID: ${id} -> '${parsed.destination}'`);
    }

    // Drawer emptiness — strategy + currentState must each have ≥1 populated field.
    // When JSON parsed, use object inspection; when it didn't, we only know key
    // PRESENCE (line-scan can't judge populated-ness without over-claiming).
    let hollow;
    if (parsed.ok) {
      hollow = !drawerPopulated(parsed.json.strategy) || !drawerPopulated(parsed.json.currentState);
    } else {
      // Degraded: presence-only. Treat absent strategy/currentState as hollow;
      // present-but-unparseable cannot be substance-judged → WARN, not counted hollow.
      hollow = !parsed.hasStrategy || !parsed.hasCurrentState;
      findings.push({
        severity: 'WARN',
        location: rel(mf),
        message: `_meta/${id}.json did not parse as JSON — drawer substance check degraded to key PRESENCE only (not a populated-field check).`,
        remediation: 'Fix the JSON so the drawer-substance check can verify strategy/currentState are actually populated, not just present.',
        reference: 'CONVENTIONS.md',
      });
    }
    if (hollow) {
      emptyDrawers += 1;
      findings.push({
        severity: 'WARN',
        location: rel(mf),
        message: `Hollow drawer: _meta/${id}.json has an empty strategy and/or currentState — the page's review primitives expose no rationale or current-state comparison.`,
        remediation: 'Populate strategy.{decision,why,...} and currentState.{summary,...}. Empty drawers pass the file-exists check but silently disable the portal review surface.',
        reference: 'docs/portal-and-tier-ladder.md § Review Portal — the drawer contract',
      });
    }
  }

  // Hollow-drawer block threshold: >25% of checked drawers empty BLOCKS.
  if (drawersChecked > 0 && emptyDrawers / drawersChecked > 0.25) {
    findings.push({
      severity: 'BLOCK',
      location: `${rel(metaDir)}/`,
      message: `${emptyDrawers}/${drawersChecked} page metas (${Math.round((emptyDrawers / drawersChecked) * 100)}%) have hollow drawers — over the 25% threshold.`,
      remediation: 'Populate strategy + currentState in the empty _meta/<page-id>.json files before sharing with stakeholders. A hollow portal answers "why this design?" with "(empty)".',
      reference: 'docs/portal-and-tier-ladder.md § Review Portal — the drawer contract',
    });
  }

  // destination issues — any missing/invalid BLOCKS (traceability-sweep key).
  if (destIssues.length) {
    findings.push({
      severity: 'BLOCK',
      location: `${rel(metaDir)}/`,
      message: `Invalid/missing destination field on ${destIssues.length} page meta(s): ${destIssues.join('; ')}.`,
      remediation: "Set destination to exactly 'product' (has a production-code projection, gets sweep-walked) or 'blueprint' (positioning/study content, sweep-skipped). An absent value lets a positioning page be treated as a product surface (the rally-hq migration-sweep failure).",
      reference: 'template/portal/CONVENTIONS.md § The destination field',
    });
  }

  // ── Check 5: I-2 — every page declares window.PROTO_PAGE. ──────────────────
  let i2Declarations = 0;
  for (const pf of pageFiles) {
    const c = (await read(path.join(pagesDir, pf))) || '';
    if (/window\.PROTO_PAGE/.test(c)) {
      i2Declarations += 1;
    } else {
      findings.push({
        severity: 'BLOCK',
        location: `${rel(pagesDir)}/${pf}`,
        message: `I-2: pages/${pf} does not declare window.PROTO_PAGE = { id: '<page-id>' } — drawers and chat depend on the page knowing its own ID.`,
        remediation: `Add <script>window.PROTO_PAGE = { id: '${baseId(pf)}' };</script> to the page <head>.`,
        reference: 'docs/portal-and-tier-ladder.md § I-2',
      });
    }
  }

  // ── Check 6: I-3 — providers come from _portal-shell.js / proto-nav.js only. ─
  const i3Violations = [];
  for (const pf of pageFiles) {
    const c = (await read(path.join(pagesDir, pf))) || '';
    if (PROVIDER_FN_RE.test(c)) {
      i3Violations.push(`pages/${pf}`);
      findings.push({
        severity: 'BLOCK',
        location: `${rel(pagesDir)}/${pf}`,
        message: `I-3: pages/${pf} redefines provider behavior (openStrategyDrawer / setComparisonMode / initChat) — cross-cutting behavior must come from _portal-shell.js / proto-nav.js, not per-page.`,
        remediation: 'Remove the local provider definition. The drawers, comparison toggle, and chat are centralized intentionally; a per-page override is drift.',
        reference: 'docs/portal-and-tier-ladder.md § I-3',
      });
    }
  }

  // ── Check 7: I-5 — inline styles (WARN, >5 still WARN per spec) + orphan CSS. ─
  let inlineStylePages = 0;
  for (const pf of pageFiles) {
    const c = (await read(path.join(pagesDir, pf))) || '';
    if (/\sstyle="/.test(c)) inlineStylePages += 1;
  }
  if (inlineStylePages > 0) {
    findings.push({
      severity: 'WARN',
      location: `${rel(pagesDir)}/`,
      message: `I-5: ${inlineStylePages} page(s) carry inline style="" attributes${inlineStylePages > 5 ? ' (>5 indicates drift from the token system)' : ''}.`,
      remediation: 'Move inline styles into shared.css / project-tokens.css tokens. Small numbers are tolerable for one-off positioning; >5 across the page set is drift.',
      reference: 'docs/portal-and-tier-ladder.md § I-5',
    });
  }
  // Orphan top-level CSS (anything other than shared.css / project-tokens.css) BLOCKS.
  let orphanCss = [];
  try {
    orphanCss = (await fs.readdir(portalDir)).filter(
      (f) => f.endsWith('.css') && f !== 'shared.css' && f !== 'project-tokens.css',
    );
  } catch {
    orphanCss = [];
  }
  if (orphanCss.length) {
    findings.push({
      severity: 'BLOCK',
      location: `${rel(portalDir)}/`,
      message: `Orphan top-level stylesheet(s): ${orphanCss.join(', ')} — only shared.css (+ project-tokens.css) may live at the portal root.`,
      remediation: 'Fold these styles into shared.css or co-locate them with the consuming page. The single-source CSS rule prevents drift.',
      reference: 'docs/portal-and-tier-ladder.md § I-5',
    });
  }

  // ── Check 8: comparison toggle wired in proto-nav.js (view-mode markers). ───
  let comparisonToggle = 'missing';
  const protoNav = await read(path.join(portalDir, 'proto-nav.js'));
  if (protoNav == null) {
    findings.push({
      severity: 'BLOCK',
      location: `${rel(portalDir)}/proto-nav.js`,
      message: 'proto-nav.js missing or unreadable — cannot verify the comparison (proposed / split / shipped) toggle.',
      remediation: 'Copy proto-nav.js from template/portal/. It implements the view-mode controller (the comparison primitive).',
      reference: 'docs/portal-and-tier-ladder.md § Review Portal comparison toggle',
    });
  } else {
    const matches = (protoNav.match(VIEW_MARKER_RE) || []).length;
    if (matches >= 3) {
      comparisonToggle = 'present';
    } else {
      comparisonToggle = matches > 0 ? 'partial' : 'missing';
      findings.push({
        severity: 'BLOCK',
        location: `${rel(portalDir)}/proto-nav.js`,
        message: `Comparison toggle ${comparisonToggle}: only ${matches} view-mode marker(s) (data-view/proposed/split/shipped) in proto-nav.js — expected ≥3 (controller + the three view-mode buttons).`,
        remediation: 'Wire the view-mode controller in proto-nav.js: toggle data-view on the compare-root between proposed, split/compare, and shipped. Review Portal requires all three view modes.',
        reference: 'docs/portal-and-tier-ladder.md § Review Portal comparison toggle',
      });
    }
  }

  // ── Check 9: chat FAB (chat-widget.js) + endpoint (functions/api/chat.js). ──
  let chatFab = 'missing';
  const chatWidget = await read(path.join(portalDir, 'chat-widget.js'));
  const chatFn = await read(path.join(portalDir, 'functions', 'api', 'chat.js'));
  const fabPresent = chatWidget != null && /chat-fab|\bfab\b|floating|chat-launch|chat-toggle/i.test(chatWidget);
  const endpointPresent = chatFn != null && /onRequest|export\s+(async\s+)?function|export\s+default/.test(chatFn);
  if (fabPresent && endpointPresent) {
    // Both present — check the backend has a corpus configured. The canonical
    // backend loads its corpus from the manifest docs via env.ASSETS; Vectorize
    // / R2 bindings are the alternative. Absence of any corpus path WARNs.
    const corpusConfigured = /Vectorize|VECTORIZE|\bR2\b|env\.ASSETS|fetchAsset|\/_docs\/|manifest\.docs/.test(chatFn);
    if (corpusConfigured) {
      chatFab = 'present';
    } else {
      chatFab = 'unconfigured';
      findings.push({
        severity: 'WARN',
        location: `${rel(portalDir)}/functions/api/chat.js`,
        message: 'Chat FAB + endpoint present but no corpus source detected (no Vectorize/R2 binding, no env.ASSETS / manifest-docs loader).',
        remediation: 'Wire a corpus: a Vectorize index binding, an R2 binding, or the canonical env.ASSETS manifest-docs loader. Land as a follow-up; not a block.',
        reference: 'docs/portal-and-tier-ladder.md § Review Portal chat',
      });
    }
  } else {
    chatFab = 'missing';
    findings.push({
      severity: 'WARN',
      location: `${rel(portalDir)}/`,
      message: `Chat ${!fabPresent ? 'FAB (chat-widget.js)' : ''}${!fabPresent && !endpointPresent ? ' and ' : ''}${!endpointPresent ? 'endpoint (functions/api/chat.js)' : ''} not detected — chat is part of the Review Portal canonical but smaller initiatives sometimes ship without it.`,
      remediation: 'Copy chat-widget.js + functions/api/chat.js from template/portal/ if chat is in scope, or record the omission as a follow-up issue.',
      reference: 'docs/portal-and-tier-ladder.md § Review Portal chat',
    });
  }

  // ── Check 10: not a deliberation venue — no variant-shaped page names. ──────
  const variantPages = pageFiles.filter((f) => VARIANT_NAME_RE.test(f));
  let deliberationFlag = 'clean';
  if (variantPages.length) {
    // Group by base name (strip the -a/-b/-v1/-variant suffix) — only BLOCK when
    // ≥2 variants of the SAME base coexist (home-a + home-b), per the spec.
    const bases = {};
    for (const f of variantPages) {
      const b = f.replace(VARIANT_NAME_RE, '.');
      bases[b] = (bases[b] || 0) + 1;
    }
    const dupBases = Object.entries(bases).filter(([, n]) => n >= 2);
    if (dupBases.length) {
      deliberationFlag = 'confirmed';
      findings.push({
        severity: 'BLOCK',
        location: `${rel(pagesDir)}/`,
        message: `Variant pages of the same base coexist (${variantPages.join(', ')}) — the portal is shaped as a deliberation venue, not a confident preview.`,
        remediation: 'Move variant-walking to blueprint/prototype/ (Tier-0 design-principles scratch) or to decisions/ ADRs. The COMPARE toggle is the comparison primitive; A/B page variants are not.',
        reference: 'docs/portal-and-tier-ladder.md § not a deliberation venue',
      });
    } else {
      deliberationFlag = 'suspect';
      findings.push({
        severity: 'WARN',
        location: `${rel(pagesDir)}/`,
        message: `Variant-shaped page name(s) present (${variantPages.join(', ')}) but no same-base pair — possibly intentional naming.`,
        remediation: 'Confirm these are single confident previews, not A/B deliberation walks. Rename if the suffix is incidental.',
        reference: 'docs/portal-and-tier-ladder.md § not a deliberation venue',
      });
    }
  }

  // ── Check 11: no residual REPLACE_FOR_PROJECT banners. ─────────────────────
  let bannerCount = 0;
  const bannered = [];
  async function walk(dir, acc) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') await walk(fp, acc);
      } else {
        acc.push(fp);
      }
    }
    return acc;
  }
  // Scan the resolved portal dir + a top-level portal/ if it also exists (spec
  // greps both blueprint/portal/ and portal/).
  const scanRoots = new Set([portalDir]);
  if (portalDir !== driftPortal && (await exists(driftPortal))) scanRoots.add(driftPortal);
  for (const root of scanRoots) {
    const files = await walk(root, []);
    for (const f of files.filter((x) => /\.(html|js|css|json|md|toml)$/.test(x))) {
      const c = await read(f);
      if (c && c.includes(BANNER)) {
        bannerCount += 1;
        bannered.push(rel(f));
      }
    }
  }
  if (bannerCount) {
    findings.push({
      severity: 'BLOCK',
      location: bannered.slice(0, 5).join(', ') + (bannered.length > 5 ? ` (+${bannered.length - 5} more)` : ''),
      message: `${bannerCount} file(s) still carry a ${BANNER} marker — placeholder/example content not yet populated or deleted.`,
      remediation: `Populate each marked surface from this initiative's deliverables, or delete the file if the page is unused. A shareable Review Portal portal has zero ${BANNER} markers.`,
      reference: 'portal-review-conformance-reviewer.md § 11',
    });
  }

  const summary =
    `shell ${shellPresent}/${REQUIRED_SHELL.length}, pages ${pageCount}, meta ${metaPresent}/${pageCount}, ` +
    `hollow ${emptyDrawers}/${drawersChecked}, dest-issues ${destIssues.length}, I-2 ${i2Declarations}/${pageCount}, ` +
    `toggle ${comparisonToggle}, chat ${chatFab}, banners ${bannerCount}`;
  return finalize(findings, summary, startedAt);
}

// ── Self-test ────────────────────────────────────────────────────────────────
// `node portal-review-conformance-reviewer.mjs` builds inline fixtures on disk,
// runs the reviewer against each, and asserts the expected verdict. Exits non-zero
// on any failure (matches the lib self-test pattern).
if (import.meta.url === `file://${process.argv[1]}`) {
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  const mkdtemp = () => fs.mkdtemp(path.join(os.tmpdir(), 'ppb-'));
  const w = async (root, relPath, content) => {
    const fp = path.join(root, relPath);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, content, 'utf8');
  };

  // A fully-conformant minimal Review Portal portal builder.
  async function buildGood(root, { variantPair = false, hollow = false, badDest = false } = {}) {
    const P = 'blueprint/portal';
    await w(root, `${P}/index.html`, '<!doctype html><html></html>');
    await w(root, `${P}/shared.css`, ':root{}');
    await w(root, `${P}/_portal-shell.js`, 'export function openStrategyDrawer(){}');
    await w(root, `${P}/chat-widget.js`, 'const fab=document.createElement("button");fab.className="chat-fab";');
    await w(
      root,
      `${P}/proto-nav.js`,
      'el.dataset.view="proposed"; const modes=["proposed","split","shipped"]; // data-view PROPOSED COMPARE SHIPPED',
    );
    await w(root, `${P}/functions/api/chat.js`, 'export async function onRequestPost(ctx){ return env.ASSETS.fetch("/_docs/x.md"); }');
    await w(
      root,
      `${P}/_meta/index.json`,
      JSON.stringify({ pages: ['home', 'pricing'] }),
    );
    const strat = hollow ? {} : { decision: 'Use a single hero', why: 'finding #3' };
    const cur = hollow ? {} : { summary: 'Today the page is a table' };
    const dest = badDest ? 'positioning' : 'product';
    for (const id of ['home', 'pricing']) {
      await w(
        root,
        `${P}/_meta/${id}.json`,
        JSON.stringify({ id, destination: dest, strategy: strat, currentState: cur }),
      );
      await w(
        root,
        `${P}/pages/${id}.html`,
        `<head><script>window.PROTO_PAGE = { id: '${id}' };</script></head><body data-view="proposed"></body>`,
      );
    }
    if (variantPair) {
      await w(root, `${P}/pages/home-a.html`, "<script>window.PROTO_PAGE={id:'home-a'};</script>");
      await w(root, `${P}/pages/home-b.html`, "<script>window.PROTO_PAGE={id:'home-b'};</script>");
      await w(root, `${P}/_meta/home-a.json`, JSON.stringify({ id: 'home-a', destination: 'product', strategy: { decision: 'x' }, currentState: { summary: 'y' } }));
      await w(root, `${P}/_meta/home-b.json`, JSON.stringify({ id: 'home-b', destination: 'product', strategy: { decision: 'x' }, currentState: { summary: 'y' } }));
    }
  }

  // 1. Good portal → PASS.
  {
    const root = await mkdtemp();
    await buildGood(root);
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'PASS', `good portal should PASS, got ${r.status} :: ${JSON.stringify(r.findings.map((f) => f.message))}`);
    assert(r.metadata.reviewer === NAME, 'reviewer name in metadata');
    assert(typeof r.metadata.durationMs === 'number', 'durationMs present');
  }

  // 2. Tier 0 → PASS short-circuit.
  {
    const root = await mkdtemp();
    const r = await review({ targetDir: root, blueprintYml: { tier: 0 } });
    assert(r.status === 'PASS' && /tier 0/.test(r.metadata.targetSummary), 'tier 0 short-circuits to PASS');
  }

  // 3. No portal → BLOCKED.
  {
    const root = await mkdtemp();
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /still at Tier 0/.test(f.message)), 'missing portal BLOCKs');
  }

  // 4. Path drift (portal/ instead of blueprint/portal/) → BLOCKED with rename note.
  {
    const root = await mkdtemp();
    await w(root, 'portal/shared.css', ':root{}');
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /non-canonical path portal\//.test(f.message)), 'portal/ drift BLOCKs with rename note');
  }

  // 5. Hollow drawers → BLOCKED (100% > 25% threshold) + WARN per-page.
  {
    const root = await mkdtemp();
    await buildGood(root, { hollow: true });
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /threshold/.test(f.message)), 'hollow drawers over 25% BLOCK');
    assert(r.findings.some((f) => /Hollow drawer/.test(f.message)), 'per-page hollow WARN emitted');
  }

  // 6. Bad destination value → BLOCKED.
  {
    const root = await mkdtemp();
    await buildGood(root, { badDest: true });
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /destination/.test(f.message)), 'invalid destination BLOCKs');
  }

  // 7. Variant pair → BLOCKED (deliberation venue).
  {
    const root = await mkdtemp();
    await buildGood(root, { variantPair: true });
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /deliberation venue/.test(f.message)), 'variant pair BLOCKs');
  }

  // 8. REPLACE_FOR_PROJECT banner → BLOCKED.
  {
    const root = await mkdtemp();
    await buildGood(root);
    await w(root, 'blueprint/portal/pages/home.html', "<script>window.PROTO_PAGE={id:'home'};</script><!-- REPLACE_FOR_PROJECT --><body data-view='proposed'></body>");
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /REPLACE_FOR_PROJECT/.test(f.message)), 'banner BLOCKs');
  }

  // 9. Missing window.PROTO_PAGE (I-2) → BLOCKED.
  {
    const root = await mkdtemp();
    await buildGood(root);
    await w(root, 'blueprint/portal/pages/home.html', "<body data-view='proposed'></body>");
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /I-2/.test(f.message)), 'missing PROTO_PAGE BLOCKs');
  }

  // 10. Per-page provider redefinition (I-3) → BLOCKED.
  {
    const root = await mkdtemp();
    await buildGood(root);
    await w(root, 'blueprint/portal/pages/home.html', "<script>window.PROTO_PAGE={id:'home'};function setComparisonMode(){}</script><body data-view='proposed'></body>");
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'BLOCKED' && r.findings.some((f) => /I-3/.test(f.message)), 'I-3 provider override BLOCKs');
  }

  // 11. Single page in manifest → WARN (not block) when everything else is clean.
  {
    const root = await mkdtemp();
    await buildGood(root);
    await w(root, 'blueprint/portal/_meta/index.json', JSON.stringify({ pages: ['home'] }));
    // remove pricing so page set matches manifest and nothing else trips
    await fs.rm(path.join(root, 'blueprint/portal/pages/pricing.html'));
    await fs.rm(path.join(root, 'blueprint/portal/_meta/pricing.json'));
    const r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    assert(r.status === 'WARN' && r.findings.some((f) => /single-page portal/.test(f.message)), `single-page portal WARNs, got ${r.status} :: ${JSON.stringify(r.findings.map((f) => f.message))}`);
  }

  // 12. NEVER THROW: malformed _meta JSON degrades to WARN, not a throw.
  {
    const root = await mkdtemp();
    await buildGood(root);
    await w(root, 'blueprint/portal/_meta/home.json', '{ this is : not json ');
    let threw = false;
    let r;
    try {
      r = await review({ targetDir: root, blueprintYml: { tier: 1 } });
    } catch {
      threw = true;
    }
    assert(!threw, 'malformed JSON must not throw');
    assert(r.findings.some((f) => /did not parse as JSON/.test(f.message)), 'malformed JSON degrades to a WARN finding');
  }

  console.log('portal-review-conformance-reviewer self-test: all assertions passed');
}
