/**
 * defrag-reviewer.mjs — executable pair for defrag-reviewer.md. The wave-50
 * coherence pass: mechanical fragmentation detection over an initiative's code
 * tree, so agent-built codebases re-cohere instead of growing outward.
 * Implements the ADR-0002 reviewer contract:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'WARN', findings: [...], metadata: {...} }
 *
 * NOT A STAGE GATE. This reviewer NEVER returns BLOCKED — by design. Defrag is
 * a cadence pass (per wave / pre-release), not a merge blocker: blocking on
 * drift would punish in-flight work for consolidation it hasn't had a chance
 * to do yet. Every finding is a consolidation CANDIDATE; whether it should
 * consolidate is agent-verified judgment (the paired .md spec). The human
 * applies; nothing here patches.
 *
 * Four mechanical checks (the fragmentation classes that ARE mechanically
 * detectable):
 *   1. Duplicate exported symbol — the same declared export name in 2+ files.
 *   2. Near-identical component filenames — Button / ButtonNew / BaseButton.
 *   3. Duplicated function bodies — identical normalized implementation in 2+
 *      places, regardless of name (the "utility reimplemented because the
 *      agent didn't know it existed" class).
 *   4. Orphan modules — code files no scanned file imports (delete/wire-up
 *      candidates). Skipped entirely when no internal import graph exists
 *      (e.g. a plain-HTML prototype) — absence of edges is not evidence.
 *
 * HONEST SCOPE:
 *   - Export/declaration matching is line-regex, not a parser. Re-export
 *     barrels (`export { x } from`) are deliberately NOT matched — a barrel is
 *     routing, not a second implementation.
 *   - Body extraction is a naive brace-matcher: braces inside strings/template
 *     literals can mis-extract. Mis-extraction is benign for THIS check — it
 *     is only used for equality grouping, and two identically mis-extracted
 *     copies are still duplicates. Nested functions inside a matched body are
 *     not separately indexed.
 *   - Orphan detection resolves RELATIVE specifiers plus the `@/`-and-`~/`
 *     → nearest-`src/` alias convention (walking up from the importing file).
 *     Bespoke tsconfig path maps are NOT parsed, so alias-exotic repos
 *     under-count inbound edges; entry-like files (pages/routes/bin/tests/
 *     configs/index) are excluded, and findings say "candidate — verify".
 *     A mis-resolved alias under-warns (file wrongly marked imported), never
 *     over-warns — the safe failure direction for a delete-candidate list.
 *   - A group that spans the template/ boundary is partitioned, never merged:
 *     boilerplate-vs-instance duplication (template/apps/portal vs apps/portal
 *     in the methodology repo) is DELIBERATE, per the source repo's charter.
 *   - "Should these consolidate?" is NOT answered here. Deliberate forks,
 *     design-system seams, and vendored kits all look like duplication to a
 *     regex. Judgment is agent-verified per the .md spec.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'defrag-reviewer';

const CODE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|astro|svelte|vue)$/i;
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.git', '.astro', '.wrangler', '.svelte-kit', '.next', '.turbo',
  '_archive', '_meta-internal', '.smoke-screenshots',
]);
// Roots scanned when present; falls back to the whole targetDir when none exist.
const SCAN_ROOTS = ['src', 'apps', 'packages', 'components', 'lib', 'tools', 'prototype', 'portal'];
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 512_000;
const MAX_FINDINGS_PER_CHECK = 20;

// Framework-conventional export names that legitimately repeat across files
// (route handlers, framework hooks). Never flagged.
const EXPORT_ALLOW = new Set([
  'default', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  'prerender', 'getStaticPaths', 'getStaticProps', 'getServerSideProps',
  'load', 'actions', 'handle', 'handleError', 'config', 'metadata',
  'generateMetadata', 'meta', 'links', 'loader', 'action', 'frontmatter',
  // compound-component sub-part names (Radix/shadcn convention): Modal.Root /
  // Tabs.Root etc. legitimately repeat per component family.
  'Root', 'Trigger', 'Content', 'Item', 'List', 'Header', 'Footer', 'Title',
  'Description', 'Provider', 'Portal', 'Overlay', 'Close', 'Body', 'Group',
]);
// Storybook CSF files export one symbol per story (Default, Info, Error, …) —
// conventional per-file repetition, excluded from the duplicate-export check.
const isStoriesFile = (rel) => /\.stories\.[^.]+$/i.test(rel);
// Framework-conventional component basenames that repeat by design.
const STEM_ALLOW = new Set(['index', 'page', 'layout', 'app', 'main', 'error', 'loading', 'route', 'document', 'head']);
// Qualifier words stripped when normalizing component stems (ButtonNew → button).
const STEM_QUALIFIERS = new Set(['new', 'old', 'base', 'copy', 'final', 'legacy', 'next', 'temp', 'tmp', 'updated', 'alt', 'v2', 'v3', '2', '3']);

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);
const exists = (p) => fs.access(p).then(() => true, () => false);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

// --- file discovery ---------------------------------------------------------

async function walk(dir, acc = []) {
  if (acc.length >= MAX_FILES) return acc;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) return acc;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(fp, acc);
    } else if (CODE_EXT.test(e.name)) {
      acc.push(fp);
    }
  }
  return acc;
}

// Partition a group of rel-paths by the template/ boundary. Boilerplate and
// instance are deliberately similar — a cross-boundary "duplicate" is the
// charter working as intended, not fragmentation. Each side is judged alone.
function partitionByBoundary(rels) {
  const inTemplate = rels.filter((r) => /^template\//.test(r));
  const outside = rels.filter((r) => !/^template\//.test(r));
  return [inTemplate, outside].filter((side) => side.length >= 2);
}

// --- check 1: duplicate exported symbols ------------------------------------

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

export function exportedNames(src) {
  const out = [];
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(src)) !== null) out.push(m[1]);
  return out;
}

// --- check 2: near-identical component stems --------------------------------

export function normalizeStem(basename) {
  const stem = basename.replace(/\.[^.]+$/, '');
  const words = stem
    .replace(/[-_.]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const core = words.filter((w) => !STEM_QUALIFIERS.has(w)).join('');
  return core.length >= 4 && !STEM_ALLOW.has(core) ? core : null;
}

const COMPONENT_EXT = /\.(tsx|jsx|astro|svelte|vue)$/i;
const isComponentFile = (rel) => COMPONENT_EXT.test(rel) && /^[A-Z]/.test(path.basename(rel));

// --- check 3: duplicated function bodies ------------------------------------

const FN_HEAD_RE = /(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;

export function extractBodies(src) {
  const out = [];
  FN_HEAD_RE.lastIndex = 0;
  let m;
  while ((m = FN_HEAD_RE.exec(src)) !== null) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) break;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break; // unbalanced (brace in string, truncated file) — stop scanning this file
    out.push({ name: m[1] || m[2] || '(anonymous)', body: src.slice(open + 1, i) });
    FN_HEAD_RE.lastIndex = i + 1;
  }
  return out;
}

export function normalizeBody(body) {
  return body
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_BODY_CHARS = 80;

// --- check 4: orphan modules -------------------------------------------------

const IMPORT_RES = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
];

const RESOLVE_EXTS = ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.astro', '.svelte', '.vue'];

function tryBases(bases, fileSet) {
  for (const base of bases) {
    const tries = [base];
    for (const ext of RESOLVE_EXTS) tries.push(base + ext);
    for (const ext of RESOLVE_EXTS) tries.push(path.join(base, 'index' + ext));
    // TS convention: source says './x.js' but the file on disk is x.ts/x.tsx.
    if (/\.js$/.test(base)) tries.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
    for (const t of tries) if (fileSet.has(t)) return t;
  }
  return null;
}

export function resolveSpecifier(fromFile, spec, fileSet, stopDir) {
  if (spec.startsWith('.')) {
    return tryBases([path.normalize(path.join(path.dirname(fromFile), spec))], fileSet);
  }
  // Alias convention: `@/x` or `~/x` → `<nearest ancestor with src/>/src/x`,
  // walking up from the importing file (bounded by stopDir). Bespoke tsconfig
  // path maps are out of scope — see HONEST SCOPE.
  const alias = /^[@~]\//.exec(spec);
  if (alias && stopDir) {
    const rest = spec.slice(2);
    const bases = [];
    let dir = path.dirname(fromFile);
    const stop = path.normalize(stopDir);
    for (let i = 0; i < 12; i++) {
      bases.push(path.join(dir, 'src', rest));
      if (dir === stop) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return tryBases(bases, fileSet);
  }
  return null; // bare specifiers (packages) out of scope
}

function isEntryLike(rel, src) {
  const lower = rel.toLowerCase();
  // `layouts/` is entry-like: Astro markdown pages reference layouts via
  // `layout:` frontmatter, which is invisible to the import graph (found the
  // hard way — DocLayout.astro false-positived in the wave-50 disposal pass).
  if (/(^|\/)(pages|routes|layouts|bin|scripts|hooks|reviewers|workers|functions|api|cli|tests?|__tests__|e2e|fixtures)\//.test(lower)) return true;
  if (/\.(test|spec|config|stories)\.[^.]+$/.test(lower)) return true;
  if (/\.d\.ts$/.test(lower)) return true;
  if (/(^|\/)(index|main|app|server|worker|setup|entry)\.[^.]+$/.test(lower)) return true;
  if (/(^|\/)\+/.test(lower)) return true; // SvelteKit +page/+layout/+server
  if (src && src.startsWith('#!')) return true; // executable script
  return false;
}

// --- main ---------------------------------------------------------------------

export default async function review({ targetDir }) {
  const startedAt = Date.now();
  const findings = [];

  // 1. Discover files.
  const roots = [];
  for (const r of SCAN_ROOTS) {
    const p = path.join(targetDir, r);
    if (await exists(p)) roots.push(p);
  }
  if (roots.length === 0 && (await exists(targetDir))) roots.push(targetDir);

  const files = [];
  for (const r of roots) await walk(r, files);
  // De-dup (overlapping roots can't happen with the fixed list, but the
  // whole-targetDir fallback makes this cheap insurance).
  const uniqueFiles = [...new Set(files)];
  const truncated = uniqueFiles.length >= MAX_FILES;

  const sources = new Map(); // abs path -> src ('' when unreadable/oversized)
  let skippedLarge = 0;
  for (const f of uniqueFiles) {
    let st = null;
    try { st = await fs.stat(f); } catch { /* unreadable → '' below */ }
    if (st && st.size > MAX_FILE_BYTES) {
      skippedLarge += 1;
      sources.set(f, '');
      continue;
    }
    sources.set(f, (await read(f)) ?? '');
  }
  const rel = (f) => path.relative(targetDir, f);

  // 2. Check 1 — duplicate exported symbols.
  const exportsByName = new Map(); // name -> rel paths
  for (const [f, src] of sources) {
    if (!src || isStoriesFile(rel(f))) continue;
    for (const name of exportedNames(src)) {
      if (EXPORT_ALLOW.has(name) || name.length < 3) continue;
      if (!exportsByName.has(name)) exportsByName.set(name, []);
      exportsByName.get(name).push(rel(f));
    }
  }
  let dupExportFindings = 0;
  let dupExportDropped = 0;
  for (const [name, allRels] of exportsByName) {
    for (const side of partitionByBoundary([...new Set(allRels)])) {
      if (dupExportFindings >= MAX_FINDINGS_PER_CHECK) { dupExportDropped += 1; continue; }
      dupExportFindings += 1;
      findings.push({
        severity: 'WARN',
        location: side.slice(0, 5).join(', ') + (side.length > 5 ? ` (+${side.length - 5} more)` : ''),
        message: `Exported symbol '${name}' is declared in ${side.length} files — duplicate-implementation candidate.`,
        remediation: `Pick one canonical home for '${name}' and import it from the others (or rename if the duplication is coincidental naming, not shared logic). Consolidate-or-keep is agent-verified per the .md spec.`,
        reference: 'defrag-reviewer.md#1-duplicate-exported-symbols',
      });
    }
  }

  // 3. Check 2 — near-identical component stems.
  const stems = new Map(); // core -> [{rel, stem}]
  for (const f of sources.keys()) {
    const r = rel(f);
    if (!isComponentFile(r)) continue;
    const core = normalizeStem(path.basename(r));
    if (!core) continue;
    if (!stems.has(core)) stems.set(core, []);
    stems.get(core).push(r);
  }
  let stemFindings = 0;
  let stemDropped = 0;
  for (const [core, allRels] of stems) {
    for (const side of partitionByBoundary([...new Set(allRels)])) {
      // Require at least two DISTINCT basenames OR the same basename in 2+
      // dirs — both shapes are the Glass "slightly different ways" smell.
      if (stemFindings >= MAX_FINDINGS_PER_CHECK) { stemDropped += 1; continue; }
      stemFindings += 1;
      findings.push({
        severity: 'WARN',
        location: side.join(', '),
        message: `Component name cluster '${core}': ${side.length} files normalize to the same stem — pattern-fragmentation candidate.`,
        remediation: 'If these are variants of one component, consolidate behind one implementation (props/slots over file forks). If they are genuinely distinct, rename so the distinction is visible. Consolidate-or-keep is agent-verified per the .md spec.',
        reference: 'defrag-reviewer.md#2-near-identical-component-names',
      });
    }
  }

  // 4. Check 3 — duplicated function bodies.
  const bodies = new Map(); // normalized body -> [{rel, name}]
  for (const [f, src] of sources) {
    if (!src) continue;
    for (const { name, body } of extractBodies(src)) {
      const norm = normalizeBody(body);
      if (norm.length < MIN_BODY_CHARS) continue;
      if (!bodies.has(norm)) bodies.set(norm, []);
      bodies.get(norm).push({ rel: rel(f), name });
    }
  }
  let bodyFindings = 0;
  let bodyDropped = 0;
  for (const entries of bodies.values()) {
    const allRels = [...new Set(entries.map((e) => e.rel))];
    if (allRels.length < 2 && entries.length < 2) continue;
    const sides = allRels.length >= 2 ? partitionByBoundary(allRels) : [allRels];
    for (const side of sides) {
      if (bodyFindings >= MAX_FINDINGS_PER_CHECK) { bodyDropped += 1; continue; }
      const names = [...new Set(entries.filter((e) => side.includes(e.rel)).map((e) => e.name))];
      if (names.length === 0) continue;
      bodyFindings += 1;
      findings.push({
        severity: 'WARN',
        location: side.join(', '),
        message: `Identical function body implemented ${entries.length}× (as: ${names.slice(0, 4).join(', ')}) — reimplemented-utility candidate.`,
        remediation: 'Extract one shared implementation and import it everywhere it is duplicated. Consolidate-or-keep is agent-verified per the .md spec.',
        reference: 'defrag-reviewer.md#3-duplicated-function-bodies',
      });
    }
  }

  // 5. Check 4 — orphan modules (only when an internal import graph exists).
  const fileSet = new Set(sources.keys());
  const imported = new Set();
  let edges = 0;
  for (const [f, src] of sources) {
    if (!src) continue;
    for (const re of IMPORT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const target = resolveSpecifier(f, m[1], fileSet, targetDir);
        if (target) {
          imported.add(target);
          edges += 1;
        }
      }
    }
  }
  let orphanFindings = 0;
  let orphanDropped = 0;
  if (edges === 0) {
    findings.push({
      severity: 'INFO',
      location: '(import graph)',
      message: 'Orphan-module check SKIPPED: no internal relative-import edges resolved (plain-HTML prototype, alias-only imports, or single-file tree). Absence of edges is not evidence of orphans.',
      remediation: 'None required.',
      reference: 'defrag-reviewer.md#4-orphan-modules',
    });
  } else {
    for (const f of sources.keys()) {
      const r = rel(f);
      if (imported.has(f)) continue;
      if (isEntryLike(r, sources.get(f))) continue;
      if (orphanFindings >= 15) { orphanDropped += 1; continue; }
      orphanFindings += 1;
      findings.push({
        severity: 'WARN',
        location: r,
        message: 'No scanned file imports this module — orphan candidate (bespoke tsconfig aliases and external consumers are NOT resolved; verify before acting).',
        remediation: 'If genuinely dead, delete it. If it should be in use, wire it in — an orphaned utility is exactly what the next agent session reimplements. Dead-or-dormant is agent-verified per the .md spec.',
        reference: 'defrag-reviewer.md#4-orphan-modules',
      });
    }
  }

  // 6. Coverage honesty — no silent caps.
  const dropped = dupExportDropped + stemDropped + bodyDropped + orphanDropped;
  if (truncated || skippedLarge > 0 || dropped > 0) {
    findings.push({
      severity: 'INFO',
      location: '(coverage)',
      message:
        `Coverage limits hit: ${truncated ? `file walk capped at ${MAX_FILES}; ` : ''}` +
        `${skippedLarge > 0 ? `${skippedLarge} oversized file(s) skipped; ` : ''}` +
        `${dropped > 0 ? `${dropped} finding group(s) dropped past per-check caps; ` : ''}` +
        'results are a floor, not a census.',
      remediation: 'Re-run scoped to a subdirectory for full coverage of a hot spot.',
      reference: 'defrag-reviewer.md#honest-scope',
    });
  }

  // 7. The judgment hand-off (always emitted when there is anything to judge).
  const warns = findings.filter((f) => f.severity === 'WARN').length;
  if (warns > 0) {
    findings.push({
      severity: 'INFO',
      location: '(judgment)',
      message: `consolidate-or-keep is agent-verified (see .md spec): each of the ${warns} candidate(s) above needs a judgment this mechanical pass cannot make — deliberate fork vs drift, design-system seam vs reimplementation, dormant vs dead. This reviewer never blocks on it.`,
      remediation: 'Run the defrag-reviewer agent spec over these findings to produce a consolidation plan.',
      reference: 'defrag-reviewer.md#how-to-judge',
    });
  }

  const summary =
    `files=${sources.size}, dup-exports=${dupExportFindings}, stem-clusters=${stemFindings}, ` +
    `dup-bodies=${bodyFindings}, orphans=${orphanFindings}${edges === 0 ? ' (graph-skip)' : ''}`;
  // NEVER BLOCKED — defrag is a coherence pass, not a merge gate.
  return result(warns > 0 ? 'WARN' : 'PASS', findings, summary, startedAt);
}

// -----------------------------------------------------------------------------
// Self-test — `node defrag-reviewer.mjs` exercises the checks against inline
// fixtures and exits non-zero on any failed assertion (matches the libs' pattern).
// -----------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`ok: ${msg}`);
    }
  };

  // -- pure helpers -----------------------------------------------------------
  assert(
    exportedNames('export function formatDate(d) {}\nexport const parseDate = (s) => {};\nexport { reExported } from "./x";').join(',') === 'formatDate,parseDate',
    'exportedNames matches declarations, skips re-export barrels'
  );
  assert(normalizeStem('ButtonNew.tsx') === 'button', 'normalizeStem strips qualifier words');
  assert(normalizeStem('BaseUserCard.tsx') === 'usercard', 'normalizeStem strips base prefix + joins words');
  assert(normalizeStem('Index.tsx') === null, 'normalizeStem null for framework names');
  assert(normalizeStem('App.tsx') === null, 'normalizeStem null for short/framework stems');

  const twoFns = 'function a(x) { return x + 1; }\nconst b = (y) => { return y * 2; };';
  const bodies = extractBodies(twoFns);
  assert(bodies.length === 2 && bodies[0].name === 'a' && bodies[1].name === 'b', 'extractBodies finds fn + arrow-const');
  assert(normalizeBody('  return 1; // note\n  /* block */ + 2 ') === 'return 1; + 2', 'normalizeBody strips comments + collapses whitespace');

  assert(
    resolveSpecifier('/r/src/a.ts', './b', new Set(['/r/src/b.ts'])) === '/r/src/b.ts',
    'resolveSpecifier adds extensions'
  );
  assert(
    resolveSpecifier('/r/src/a.ts', './lib', new Set(['/r/src/lib/index.ts'])) === '/r/src/lib/index.ts',
    'resolveSpecifier resolves directory index'
  );
  assert(
    resolveSpecifier('/r/src/a.ts', './b.js', new Set(['/r/src/b.ts'])) === '/r/src/b.ts',
    'resolveSpecifier maps TS .js convention'
  );
  assert(
    resolveSpecifier('/r/apps/web/src/pages/p.ts', '@/lib/b', new Set(['/r/apps/web/src/lib/b.ts']), '/r') === '/r/apps/web/src/lib/b.ts',
    'resolveSpecifier resolves @/ against the nearest ancestor src/'
  );
  assert(resolveSpecifier('/r/src/a.ts', '@scope/pkg', new Set(), '/r') === null, 'resolveSpecifier ignores bare package specifiers');

  // -- end-to-end review() over a temp fixture tree ----------------------------
  const os = await import('node:os');
  const fsp = (await import('node:fs')).promises;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'defrag-'));
  const w = (p, s) => fsp
    .mkdir(path.dirname(path.join(tmp, p)), { recursive: true })
    .then(() => fsp.writeFile(path.join(tmp, p), s));

  const LONG_BODY =
    'const out = [];\n  for (let i = 0; i < items.length; i++) { out.push(String(items[i]).trim().toLowerCase()); }\n  return out.join("-");';
  await w('src/utils/date.ts', `export function formatDate(items) {\n  ${LONG_BODY}\n}\n`);
  await w('src/components/helpers.ts', `export function formatDate(items) {\n  ${LONG_BODY}\n}\n`);
  await w('src/components/Button.tsx', 'export default function Button() { return null; }\n');
  await w('src/components/ButtonNew.tsx', 'export default function ButtonNew() { return null; }\n');
  await w('src/api/one.ts', 'export function GET() { return new Response("1"); }\n');
  await w('src/api/two.ts', 'export function GET() { return new Response("2"); }\n');
  await w('src/components/modal/modal.tsx', 'export const Trigger = () => null;\n');
  await w('src/components/tabs/tabs.tsx', 'export const Trigger = () => null;\n');
  await w('src/stories/alert.stories.tsx', 'export const Spinner = () => null;\n');
  await w('src/stories/badge.stories.tsx', 'export const Spinner = () => null;\n');
  await w('src/orphan-util.ts', 'export function lonely(a) { return a; }\n');
  await w('src/used.ts', 'export const used = 1;\n');
  await w(
    'src/index.ts',
    'import "./used";\nimport "./utils/date";\nimport "./components/helpers";\nimport "./components/Button";\nimport "./components/ButtonNew";\nimport "./api/one";\nimport "./api/two";\n'
  );
  // template-boundary partition: a lone template-side Button must NOT merge
  // with the non-template cluster (and 1 file per side is never a finding).
  await w('template/src/components/Button.tsx', 'export default function Button() { return null; }\n');

  const res = await review({ targetDir: tmp });
  assert(res.status === 'WARN', 'review WARNs on a fragmented tree (never BLOCKED)');
  assert(
    res.findings.some((f) => f.severity === 'WARN' && /'formatDate' is declared in 2 files/.test(f.message)),
    'duplicate exported symbol flagged'
  );
  assert(
    !res.findings.some((f) => /'GET'/.test(f.message)),
    'framework-conventional export (GET) not flagged'
  );
  assert(
    !res.findings.some((f) => /'Trigger'/.test(f.message)),
    'compound-component sub-part export (Trigger) not flagged'
  );
  assert(
    !res.findings.some((f) => /'Spinner'/.test(f.message)),
    'storybook CSF story exports not flagged'
  );
  assert(
    res.findings.some((f) => f.severity === 'WARN' && /cluster 'button'/.test(f.message) && !/template\//.test(f.location)),
    'Button/ButtonNew stem cluster flagged, template side partitioned out'
  );
  assert(
    res.findings.some((f) => f.severity === 'WARN' && /Identical function body/.test(f.message)),
    'duplicated function body flagged'
  );
  assert(
    res.findings.some((f) => f.severity === 'WARN' && f.location === 'src/orphan-util.ts' && /orphan candidate/.test(f.message)),
    'orphan module flagged'
  );
  assert(
    !res.findings.some((f) => f.location === 'src/used.ts' || f.location === 'src/index.ts'),
    'imported + entry-like files not orphan-flagged'
  );
  assert(
    res.findings.some((f) => f.severity === 'INFO' && /agent-verified/.test(f.message)),
    'agent-verified judgment hand-off emitted'
  );
  assert(res.metadata.reviewer === NAME, 'metadata carries the reviewer name');

  // clean tree → PASS.
  const clean = await fsp.mkdtemp(path.join(os.tmpdir(), 'defrag-clean-'));
  await fsp.mkdir(path.join(clean, 'src'), { recursive: true });
  await fsp.writeFile(path.join(clean, 'src', 'index.ts'), 'import "./only";\n');
  await fsp.writeFile(path.join(clean, 'src', 'only.ts'), 'export const one = 1;\n');
  const cleanRes = await review({ targetDir: clean });
  assert(cleanRes.status === 'PASS', 'clean tree → PASS');

  // no import graph → orphan check skipped with an INFO, no orphan WARNs.
  const flat = await fsp.mkdtemp(path.join(os.tmpdir(), 'defrag-flat-'));
  await fsp.mkdir(path.join(flat, 'src'), { recursive: true });
  await fsp.writeFile(path.join(flat, 'src', 'a.ts'), 'export const a = 1;\n');
  await fsp.writeFile(path.join(flat, 'src', 'b.ts'), 'export const b = 2;\n');
  const flatRes = await review({ targetDir: flat });
  assert(
    flatRes.findings.some((f) => f.severity === 'INFO' && /Orphan-module check SKIPPED/.test(f.message)),
    'orphan check skipped (INFO) when no internal import graph exists'
  );
  assert(
    !flatRes.findings.some((f) => /orphan candidate/.test(f.message)),
    'no orphan WARNs without an import graph'
  );

  // never-throws on a non-existent target dir.
  const ghost = await review({ targetDir: path.join(tmp, 'does-not-exist') });
  assert(ghost && ghost.status === 'PASS', 'review degrades gracefully on a missing dir');

  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.rm(clean, { recursive: true, force: true });
  await fsp.rm(flat, { recursive: true, force: true });

  if (process.exitCode) console.error('\ndefrag-reviewer self-test FAILED');
  else console.log('\ndefrag-reviewer self-test PASSED');
}
