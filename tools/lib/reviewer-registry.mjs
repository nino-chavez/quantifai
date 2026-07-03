// reviewer-registry.mjs — discover executable reviewers across canonical + org
// sources so a department extends Blueprint WITHOUT forking (ADR-0006). The
// interface IS ADR-0002's review() — there is no SDK; the signature is the SDK.
// Lifts state-derive's walkCatalog + dynamic-import + duck-type loop; only the
// predicate changes (a default export that is a function). Dependency-free,
// never throws.
//
// Three sources, convention-discovered (no central-registration array — that
// recreates the merge-conflict choke point a platform exists to remove):
//   canonical  — <home>/template/.claude/agents/blueprint/reviewers/*.mjs
//   org-local  — <targetDir>/.blueprint/reviewers/*.mjs   (the consumer's own)
//   org-npm    — installed packages with keywords:['blueprint-reviewer'],
//                their reviewers/*.mjs   (best-effort; node_modules scan)
//
// Binding stays VISIBLE: canonical is authoritative for its name; an org
// reviewer reusing a canonical name is a SHADOW (recorded + WARNed, canonical
// wins — an org reviewer may tighten via its OWN gate, never relax a canonical
// one). org-local overrides org-npm of the same name.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function walkReviewers(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith('_')) continue; // examples / scratch
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walkReviewers(full));
    else if (st.isFile() && name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const nameOf = (path) => path.split('/').pop().replace(/\.mjs$/, '');

function canonicalDir(home) {
  return join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers');
}
function orgLocalDir(targetDir) {
  return join(targetDir, '.blueprint', 'reviewers');
}

// Best-effort npm-keyword scan: a package opts in with keywords:['blueprint-reviewer']
// and ships reviewers/*.mjs. We scan the target's node_modules (+ scoped dirs).
function npmReviewers(targetDir) {
  const out = [];
  const nm = join(targetDir, 'node_modules');
  if (!existsSync(nm)) return out;
  let pkgs;
  try { pkgs = readdirSync(nm); } catch { return out; }
  const candidates = [];
  for (const p of pkgs) {
    if (p.startsWith('.')) continue;
    if (p.startsWith('@')) {
      // scoped: descend one level
      let scoped;
      try { scoped = readdirSync(join(nm, p)); } catch { continue; }
      for (const s of scoped) candidates.push(join(nm, p, s));
    } else {
      candidates.push(join(nm, p));
    }
  }
  for (const dir of candidates) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const kw = Array.isArray(pkg.keywords) ? pkg.keywords : [];
    if (!kw.includes('blueprint-reviewer')) continue;
    for (const f of walkReviewers(join(dir, 'reviewers'))) out.push({ path: f, pkg: pkg.name });
  }
  return out;
}

/**
 * Discover all reviewers, deduped by name with precedence
 * canonical > org-local > org-npm. Returns { active, shadows }:
 *   active:  [{ name, path, source, pkg? }] sorted canonical-first then by name
 *   shadows: [{ name, source, pkg?, shadowedBy }]  (a same-name collision)
 * Never throws.
 */
export function discoverReviewers({ home, targetDir } = {}) {
  const byName = new Map();
  const shadows = [];
  const add = (name, entry) => {
    if (byName.has(name)) {
      shadows.push({ name, source: entry.source, pkg: entry.pkg, shadowedBy: byName.get(name).source });
    } else {
      byName.set(name, entry);
    }
  };

  // canonical FIRST → authoritative for its name.
  if (home) for (const p of walkReviewers(canonicalDir(home))) add(nameOf(p), { name: nameOf(p), path: p, source: 'canonical' });
  // org-local next → overrides org-npm, shadows canonical (recorded, canonical kept).
  if (targetDir) for (const p of walkReviewers(orgLocalDir(targetDir))) add(nameOf(p), { name: nameOf(p), path: p, source: 'org-local' });
  // org-npm last.
  if (targetDir) for (const { path: p, pkg } of npmReviewers(targetDir)) add(nameOf(p), { name: nameOf(p), path: p, source: 'org-npm', pkg });

  const rank = { canonical: 0, 'org-local': 1, 'org-npm': 2 };
  const active = [...byName.values()].sort((a, b) => (rank[a.source] - rank[b.source]) || a.name.localeCompare(b.name));
  return { active, shadows };
}

/** Resolve a single reviewer by name across all sources (canonical wins). */
export function resolveReviewer(name, { home, targetDir } = {}) {
  const { active, shadows } = discoverReviewers({ home, targetDir });
  return { entry: active.find((r) => r.name === name) || null, shadows: shadows.filter((s) => s.name === name) };
}

/**
 * Validate a loaded reviewer module against the ADR-0002 contract WITHOUT
 * invoking it (invocation has side effects). The "SDK" reframed as a validator.
 * Returns { valid, reason }.
 */
export function validateReviewerModule(mod) {
  const fn = mod && mod.default;
  // The contract is "default export is a function." Arity is deliberately NOT
  // checked: `fn.length` is 0 for a valid `(ctx = {}) => …` (default param) or
  // `(...args) => …` (rest), so an arity gate false-rejects legitimate
  // signatures to catch a `() => …` mistake that just fails at runtime anyway.
  if (typeof fn !== 'function') return { valid: false, reason: 'no default export function (ADR-0002 review() contract)' };
  return { valid: true, reason: 'ok' };
}

/** Load + validate a reviewer module from a path (never throws; returns {ok,fn,reason}). */
export async function loadReviewer(path) {
  let mod;
  try { mod = await import(pathToFileURL(path).href); }
  catch (e) { return { ok: false, fn: null, reason: `failed to load: ${e.message}` }; }
  const v = validateReviewerModule(mod);
  return { ok: v.valid, fn: v.valid ? mod.default : null, reason: v.reason };
}

// ── Self-test (node reviewer-registry.mjs --self-test) ───────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  const os = await import('node:os');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');

  const root = mkdtempSync(join(os.tmpdir(), 'bp-revreg-'));
  const home = join(root, 'home');
  const target = join(root, 'consumer');
  const canon = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers');
  const orgl = join(target, '.blueprint', 'reviewers');
  mkdirSync(canon, { recursive: true });
  mkdirSync(orgl, { recursive: true });

  const REVIEWER = 'export default async function review({ targetDir }) { return { status: "PASS", findings: [], metadata: {} }; }\n';
  writeFileSync(join(canon, 'portal-pattern-a-conformance-reviewer.mjs'), REVIEWER);
  writeFileSync(join(canon, 'cost-gate-reviewer.mjs'), REVIEWER);
  writeFileSync(join(canon, '_scratch.mjs'), REVIEWER); // underscore → skipped
  writeFileSync(join(orgl, 'acme-naming-reviewer.mjs'), REVIEWER);
  writeFileSync(join(orgl, 'cost-gate-reviewer.mjs'), REVIEWER); // SHADOWS a canonical name

  const { active, shadows } = discoverReviewers({ home, targetDir: target });
  const names = active.map((r) => r.name);
  assert(names.includes('acme-naming-reviewer'), 'org-local reviewer discovered');
  assert(!names.includes('_scratch'), 'underscore-prefixed skipped');
  assert(active.find((r) => r.name === 'cost-gate-reviewer').source === 'canonical', 'canonical wins a name collision');
  assert(shadows.some((s) => s.name === 'cost-gate-reviewer' && s.source === 'org-local'), 'org-local shadow of canonical recorded');
  assert(active[0].source === 'canonical', 'sorted canonical-first');
  assert(active.filter((r) => r.name === 'cost-gate-reviewer').length === 1, 'deduped — one active per name');

  const r = resolveReviewer('acme-naming-reviewer', { home, targetDir: target });
  assert(r.entry && r.entry.source === 'org-local', 'resolveReviewer finds an org reviewer');
  assert(resolveReviewer('nope', { home, targetDir: target }).entry === null, 'resolveReviewer null for unknown');

  // Validation.
  assert(validateReviewerModule({ default: async ({ targetDir }) => ({}) }).valid, 'valid reviewer module');
  assert(validateReviewerModule({ default: async (ctx = {}) => ({}) }).valid, 'default-param signature valid (arity not enforced — avoids a false reject)');
  assert(!validateReviewerModule({ default: 42 }).valid, 'non-function default → invalid');
  assert(!validateReviewerModule({}).valid, 'no default → invalid');

  const loaded = await loadReviewer(join(orgl, 'acme-naming-reviewer.mjs'));
  assert(loaded.ok && typeof loaded.fn === 'function', 'loadReviewer loads + validates');
  assert((await loadReviewer(join(orgl, 'missing.mjs'))).ok === false, 'loadReviewer missing → ok:false (no throw)');

  // Empty discovery never throws.
  assert(discoverReviewers({}).active.length === 0, 'empty discovery → []');

  console.log('reviewer-registry self-test: PASS (15 assertions)');
}
