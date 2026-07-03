// doctor.mjs — `blueprint doctor`, the trust-at-scale conformance/health capstone
// (build-order step 12). It gates on REAL runtime verification — it actually
// loads the config, loads + validates every discovered reviewer, and RUNS the
// portal conformance reviewer — rather than a curl-200 / files-exist false-green.
// And it is honest about its own boundary: it reports what it did NOT check
// (full build + browser verification is out of v1 scope) so it never claims a
// green it did not earn — the anti-false-green discipline applied to itself.
//
// Read-only. Dependency-free orchestration over the already-shipped libs
// (cost-dial, consumers-registry, reviewer-registry) + the conformance reviewer.
// Never throws; each check degrades to a finding.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const libUrl = (home, name) => pathToFileURL(join(home, 'template', 'tools', 'lib', name)).href;

/**
 * A bespoke portal (portal_type: bespoke — fits neither Initiative Portal nor
 * Review Portal, wave 46) gates on the PRESENCE of a divergence ADR; its
 * absence is the violation. Find one by filename convention in the consumer's
 * decisions dirs. Returns the basename, or null.
 */
function findDivergenceAdr(targetDir) {
  const rx = /(portal.*(bespoke|divergen)|(bespoke|divergen).*portal)/i;
  for (const d of [join(targetDir, 'decisions'), join(targetDir, 'blueprint', 'decisions')]) {
    try {
      const hit = readdirSync(d).find((f) => f.endsWith('.md') && rx.test(f));
      if (hit) return hit;
    } catch { /* dir absent — keep looking */ }
  }
  return null;
}

// A check returns { name, status: 'pass'|'warn'|'fail'|'skip', detail, remediation? }.
const worst = (a, b) => {
  const rank = { pass: 0, skip: 0, warn: 1, fail: 2 };
  return rank[b] > rank[a] ? b : a;
};

/**
 * Run the doctor against a target (a consumer repo, or the methodology home
 * itself). Returns { checks, status, notChecked }. Never throws.
 */
export async function runDoctor({ home, targetDir }) {
  const checks = [];
  const add = (name, status, detail, remediation) => checks.push({ name, status, detail, ...(remediation ? { remediation } : {}) });

  // 1. methodology-home — the resolver wired a real source (proves the install).
  if (home && existsSync(join(home, 'template'))) {
    add('methodology-home', 'pass', `resolved at ${home}`);
  } else {
    add('methodology-home', 'fail', `methodology home not resolvable (${home || 'unset'})`, 'set $BLUEPRINT_HOME or blueprint.yml methodology_home; reinstall @nino-chavez-labs/blueprint-cli');
    return { checks, status: 'fail', notChecked: ['everything else — no methodology home'] };
  }

  const ymlPath = join(targetDir, 'blueprint.yml');
  const hasYml = existsSync(ymlPath);

  // 2. blueprint.yml — present + parseable + declares a tier.
  let tier = null;
  let portalPattern = null;
  if (!hasYml) {
    add('blueprint-yml', 'warn', `no blueprint.yml at ${targetDir} (running against the methodology home, or an unstamped dir)`);
  } else {
    try {
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(ymlPath, 'utf8');
      const m = /^\s*tier:\s*([0-9]+)/m.exec(text);
      tier = m ? Number(m[1]) : null;
      // Read portal_type (canonical, wave 72) with portal_pattern as deprecated fallback.
      const ptNew = /^\s*portal_type:\s*(\w+)/m.exec(text);
      const ptLegacy = /^\s*portal_pattern:\s*(\w+)/m.exec(text);
      if (ptNew) {
        portalPattern = ptNew[1].toLowerCase();
      } else if (ptLegacy) {
        portalPattern = ptLegacy[1].toLowerCase();
        // Map legacy A/B values to new names for internal use
        if (portalPattern === 'a') portalPattern = 'initiative';
        else if (portalPattern === 'b') portalPattern = 'review';
        add('blueprint-yml', 'warn', 'blueprint.yml uses deprecated `portal_pattern:` field — rename to `portal_type:` with values initiative|review|bespoke (wave 72)', 'run: sed -i \'\' \'s/portal_pattern:/portal_type:/; s/portal_type: A/portal_type: initiative/; s/portal_type: B/portal_type: review/\' blueprint.yml');
      }
      if (tier == null) add('blueprint-yml', 'warn', 'blueprint.yml present but no `tier:` declared');
      else add('blueprint-yml', 'pass', `tier ${tier}`);
    } catch (e) {
      add('blueprint-yml', 'fail', `blueprint.yml unreadable: ${e.message}`, 'fix the file');
    }
  }

  // 3. cost-config — the cost block resolves; flag any below-anchor-unjustified
  //    stage (the step-6 gate would BLOCK it). Reuses cost-dial.
  if (hasYml) {
    try {
      const cd = await import(libUrl(home, 'cost-dial.mjs'));
      const cost = cd.readCostBlock(targetDir);
      if (!cost.present) {
        add('cost-config', 'pass', 'no cost: block (built-in defaults — advisory)');
      } else {
        const flagged = Object.keys(cd.ANCHORS)
          .map((s) => ({ s, up: cd.underProcessed(s, cd.resolveCost(cost, s)) }))
          .filter((x) => x.up.belowAnchor);
        if (flagged.length) add('cost-config', 'warn', `${flagged.length} stage(s) below anchor without skip_justification: ${flagged.map((f) => f.s).join(', ')}`, 'run `blueprint cost` — raise the stage or add a skip_justification');
        else add('cost-config', 'pass', 'all stages at/above anchor or justified');
      }
    } catch (e) {
      add('cost-config', 'fail', `cost-dial failed to load/parse: ${e.message}`);
    }
  }

  // 4. reviewers-loadable — every discovered reviewer (canonical + org) actually
  //    LOADS + validates. A broken .mjs is a real FAIL, not a files-exist green.
  try {
    const rr = await import(libUrl(home, 'reviewer-registry.mjs'));
    const { active, shadows } = rr.discoverReviewers({ home, targetDir });
    const broken = [];
    for (const r of active) {
      const loaded = await rr.loadReviewer(r.path);
      if (!loaded.ok) broken.push(`${r.name} (${r.source}): ${loaded.reason}`);
    }
    if (broken.length) add('reviewers-loadable', 'fail', `${broken.length}/${active.length} reviewer(s) fail to load/validate: ${broken.join('; ')}`, 'fix the reviewer .mjs to match the ADR-0002 review() contract');
    else add('reviewers-loadable', 'pass', `${active.length} reviewer(s) load + validate${shadows.length ? ` (${shadows.length} shadowed)` : ''}`);
  } catch (e) {
    add('reviewers-loadable', 'fail', `reviewer-registry failed: ${e.message}`);
  }

  // 5. consumers-registry — if a methodology-side consumers.yml exists, it parses
  //    cleanly (no malformed/duplicate entries = a structurally-suspect registry).
  if (existsSync(join(home, 'consumers.yml'))) {
    try {
      const cr = await import(libUrl(home, 'consumers-registry.mjs'));
      const reg = cr.readConsumersRegistry(join(home, 'consumers.yml'));
      if (reg.skippedItems > 0 || reg.duplicates.length > 0) add('consumers-registry', 'warn', `registry suspect: ${reg.skippedItems} malformed, ${reg.duplicates.length} duplicate(s)`, 'run `blueprint fleet` to inspect');
      else add('consumers-registry', 'pass', `${reg.consumers.length} consumer(s) registered`);
    } catch (e) {
      add('consumers-registry', 'fail', `consumers.yml failed to parse: ${e.message}`);
    }
  }

  // 6. portal-conformance. An Initiative Portal RUNS its reviewer (runtime
  //    verification, not a files-exist check). A portal that declares
  //    `portal_type: bespoke` fits neither Initiative Portal nor Review Portal
  //    (wave 46) — so NEITHER conformance reviewer runs; the gate instead is
  //    the PRESENCE of a divergence ADR (its absence is the violation).
  //    Automated here on the 2nd bespoke instance (the methodology's own
  //    product-site portal), per the wave-46 "automate on the 2nd instance" trigger.
  if (existsSync(join(targetDir, 'apps', 'portal'))) {
    if (portalPattern === 'bespoke') {
      const adr = findDivergenceAdr(targetDir);
      if (adr) {
        add('portal-conformance', 'pass', `bespoke portal — divergence recorded in ${adr}; Initiative/Review Portal conformance not applicable`);
      } else {
        add('portal-conformance', 'fail', 'portal_type: bespoke but no divergence ADR found in decisions/', "record the divergence — write decisions/NNNN-portal-bespoke-*.md per docs/portal-and-tier-ladder.md (a bespoke portal's gate is the ADR's presence; its absence is the violation)");
      }
    } else {
      try {
        const reviewerPath = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', 'portal-initiative-conformance-reviewer.mjs');
        if (existsSync(reviewerPath)) {
          const fn = (await import(pathToFileURL(reviewerPath).href)).default;
          const res = await fn({ targetDir, blueprintYml: { tier }, methodologyHome: home });
          const map = { PASS: 'pass', WARN: 'warn', BLOCKED: 'fail' };
          add('portal-conformance', map[res.status] || 'warn', `${res.status} — ${(res.metadata && res.metadata.targetSummary) || ''} (${(res.findings || []).length} finding(s))`, res.status === 'BLOCKED' ? 'run `blueprint review portal-initiative-conformance-reviewer --target=<dir>` for details' : undefined);
        } else {
          add('portal-conformance', 'skip', 'conformance reviewer not present in this methodology home');
        }
      } catch (e) {
        add('portal-conformance', 'fail', `portal conformance reviewer threw: ${e.message}`);
      }
    }
  }

  // 7. doc-currency — docs reference files/paths/commands that exist (wave 50).
  //    RUNS the reviewer (runtime verification): broken internal links → fail,
  //    unknown CLI mentions → warn; unresolved citations are agent-verified
  //    INFO inside the reviewer and do not gate here.
  try {
    const reviewerPath = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', 'doc-currency-reviewer.mjs');
    if (existsSync(reviewerPath)) {
      const fn = (await import(pathToFileURL(reviewerPath).href)).default;
      const res = await fn({ targetDir, methodologyHome: home });
      const map = { PASS: 'pass', WARN: 'warn', BLOCKED: 'fail' };
      add('doc-currency', map[res.status] || 'warn', `${res.status} — ${(res.metadata && res.metadata.targetSummary) || ''}`, res.status !== 'PASS' ? 'run `blueprint review doc-currency-reviewer` for details' : undefined);
    } else {
      add('doc-currency', 'skip', 'doc-currency reviewer not present in this methodology home');
    }
  } catch (e) {
    add('doc-currency', 'fail', `doc-currency reviewer threw: ${e.message}`);
  }

  // 8. stateful-claim lint — counts/versions/"latest" claims in living docs
  //    match their sources of truth (wave 59). Drifted wave-currency claims →
  //    fail; count/version drift → warn; consumer repos without the sources
  //    (WAVE-LOG, consumers.yml) skip those checks inside the reviewer.
  try {
    const reviewerPath = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', 'stateful-claim-lint-reviewer.mjs');
    if (existsSync(reviewerPath)) {
      const fn = (await import(pathToFileURL(reviewerPath).href)).default;
      const res = await fn({ targetDir, methodologyHome: home });
      const map = { PASS: 'pass', WARN: 'warn', BLOCKED: 'fail' };
      add('stateful-claims', map[res.status] || 'warn', `${res.status} — ${(res.metadata && res.metadata.targetSummary) || ''}`, res.status !== 'PASS' ? 'run `blueprint review stateful-claim-lint-reviewer` for details' : undefined);
    } else {
      add('stateful-claims', 'skip', 'stateful-claim-lint reviewer not present in this methodology home');
    }
  } catch (e) {
    add('stateful-claims', 'fail', `stateful-claim-lint reviewer threw: ${e.message}`);
  }

  // 9. roadmap-registry sync — registry (e.g., prescription.yml) and view docs
  //    (e.g., roadmap.md) must stay synchronized (wave 27). Four mechanical
  //    checks: active items in registry must appear in view; shipped items
  //    cannot be in build sections; all view references must exist in registry;
  //    ids must be unique. Declared pairs in blueprint.yml; default pair
  //    (prescription.yml ↔ docs/roadmap.md) when both exist.
  try {
    const reviewerPath = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', 'roadmap-registry-sync-reviewer.mjs');
    if (existsSync(reviewerPath)) {
      const fn = (await import(pathToFileURL(reviewerPath).href)).default;
      const res = await fn({ targetDir, blueprintYml: null, methodologyHome: home });
      const map = { PASS: 'pass', WARN: 'warn', BLOCKED: 'fail' };
      add('registry-sync', map[res.status] || 'warn', `${res.status} — ${(res.metadata && res.metadata.targetSummary) || ''}`, res.status !== 'PASS' ? 'run `blueprint review roadmap-registry-sync-reviewer` for details' : undefined);
    } else {
      add('registry-sync', 'skip', 'roadmap-registry-sync reviewer not present in this methodology home');
    }
  } catch (e) {
    add('registry-sync', 'fail', `roadmap-registry-sync reviewer threw: ${e.message}`);
  }

  // 10. terminology — user-facing copy carries no deprecated methodology
  //     labels, unglossed jargon, or brand anti-patterns (wave 72 rules).
  //     Wired here in wave 77: the linter's BLOCK findings sat live on the
  //     deployed portal for three weeks because it was invocation-only —
  //     the same detection-without-enforcement class waves 55 and 75 closed
  //     for doctor and release.
  try {
    const reviewerPath = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', 'terminology-linter.mjs');
    if (existsSync(reviewerPath)) {
      const fn = (await import(pathToFileURL(reviewerPath).href)).default;
      const res = await fn({ targetDir, blueprintYml: null, methodologyHome: home });
      const map = { PASS: 'pass', WARN: 'warn', BLOCKED: 'fail' };
      add('terminology', map[res.status] || 'warn', `${res.status} — ${(res.metadata && res.metadata.targetSummary) || ''}`, res.status !== 'PASS' ? 'run `blueprint review terminology-linter` for details' : undefined);
    } else {
      add('terminology', 'skip', 'terminology-linter not present in this methodology home');
    }
  } catch (e) {
    add('terminology', 'fail', `terminology-linter threw: ${e.message}`);
  }

  // 11. lint-jurisdiction — the union of the drift lints' declared scan sets,
  //     diffed against the tree's actual prose surfaces (wave 77, from the
  //     2026-07-02 jurisdiction audit). Informational by design: uncovered
  //     surfaces WARN, never fail — the check's job is to make a new surface
  //     or a new scanner automatically re-raise the coverage question instead
  //     of each gap being operator-found. Record dirs (append-only receipts)
  //     are exempt: their claims were true at writing.
  try {
    const scannerFiles = ['doc-currency-reviewer.mjs', 'stateful-claim-lint-reviewer.mjs', 'terminology-linter.mjs'];
    const decls = [];
    for (const f of scannerFiles) {
      const p = join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers', f);
      if (!existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      if (mod.jurisdiction) decls.push(mod.jurisdiction);
    }
    if (decls.length === 0) {
      add('lint-jurisdiction', 'skip', 'no scanning reviewer declares a jurisdiction export');
    } else {
      const SKIP_WALK = new Set(['node_modules', '.git', 'dist', '.astro', '.wrangler', '.changeset', '.claude', '.github']);
      const RECORD_DIRS = new Set(['_archive', 'case-studies', 'feedback', 'research', 'decisions', 'handoffs', 'raw']);
      const RECORD_FILES = new Set(['WAVE-LOG.md', 'METHODOLOGY-AMENDMENTS.md', 'CHANGELOG.md', 'HANDOFF.md', 'LICENSE.md']);
      // Code-adjacent operator docs (a README next to a package, a DESIGN.md
      // next to a prototype) are working language, not reader-path surfaces —
      // same exemption the terminology-linter applies inside its own roots.
      // Root-level files are NOT exempt (the repo-root README is the public
      // entry point); the exemption applies only inside subtrees.
      const OPERATOR_BASENAMES = new Set(['README.md', 'DESIGN.md', 'CONVENTIONS.md', 'CLAUDE.md', 'STATE.md', 'BOOTSTRAP.md', 'ONBOARDING.md', 'CONTRIBUTING.md', 'TESTING.md', 'SETUP.md']);
      const PROSE_EXT = new Set(['.md', '.astro', '.html']);
      const surfaces = [];
      const walk = (dir, rel) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.isDirectory()) {
            if (!SKIP_WALK.has(e.name) && !RECORD_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
          } else {
            const ext = e.name.slice(e.name.lastIndexOf('.'));
            if (!PROSE_EXT.has(ext) || RECORD_FILES.has(e.name) || /^\d{4}-\d{2}-\d{2}-/.test(e.name)) continue;
            if (rel && OPERATOR_BASENAMES.has(e.name)) continue;
            surfaces.push(rel ? `${rel}/${e.name}` : e.name);
          }
        }
      };
      walk(targetDir, '');
      const covers = (d, rel) => {
        if ((d.rootFiles || []).includes(rel)) return true;
        const inRoot = (d.roots || []).some((r) => rel.startsWith(`${r}/`));
        if (!inRoot) return false;
        if (d.extensions && !d.extensions.some((x) => rel.endsWith(x))) return false;
        if ((d.excludes || []).some((x) => rel.split('/').includes(x))) return false;
        return true;
      };
      // A template/ path is covered when its STAMPED location is covered: the
      // substrate is linted consumer-side after stamping (e.g. template/apps/
      // portal/src → apps/portal/src falls inside the terminology roots, and
      // doctor's terminology check enforces it in every consumer). Source-side
      // rot therefore surfaces at the first consumer doctor run.
      const uncovered = surfaces.filter(
        (rel) => !decls.some((d) => covers(d, rel)) &&
          !(rel.startsWith('template/') && decls.some((d) => covers(d, rel.slice('template/'.length))))
      );
      const sample = uncovered.slice(0, 4).join(', ');
      add(
        'lint-jurisdiction',
        uncovered.length ? 'warn' : 'pass',
        `${uncovered.length ? 'WARN' : 'PASS'} — scanners=${decls.length}, prose-surfaces=${surfaces.length}, uncovered=${uncovered.length}`,
        uncovered.length ? `uncovered by every drift lint: ${sample}${uncovered.length > 4 ? ` (+${uncovered.length - 4} more)` : ''}` : undefined
      );
    }
  } catch (e) {
    add('lint-jurisdiction', 'fail', `lint-jurisdiction check threw: ${e.message}`);
  }

  const status = checks.reduce((acc, c) => worst(acc, c.status), 'pass');
  // Honesty about the boundary: name what doctor did NOT verify, so a green is
  // never read as more than it is.
  const notChecked = [
    'full build (npm/astro build) — run it in CI / the deploy step',
    'browser/runtime rendering (Playwright) — out of v1 doctor scope; the deploy gate owns it',
  ];
  return { checks, status, notChecked };
}

// ── Self-test (node doctor.mjs --self-test) ──────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };

  // worst() ordering.
  assert(worst('pass', 'warn') === 'warn' && worst('warn', 'fail') === 'fail' && worst('fail', 'pass') === 'fail' && worst('pass', 'skip') === 'pass', 'worst() severity ordering');

  // No methodology home → single failing check, short-circuits.
  const r1 = await runDoctor({ home: '/no/such/home', targetDir: '/tmp' });
  assert(r1.status === 'fail' && r1.checks.length === 1 && r1.checks[0].name === 'methodology-home', 'no home → fail + short-circuit');

  // Against the REAL methodology home (this worktree), no target yml → home runs.
  // The home is three levels up from template/tools/lib/.
  const path = await import('node:path');
  const here = new URL('.', import.meta.url).pathname; // .../template/tools/lib/
  const home = path.resolve(here, '..', '..', '..'); // methodology root
  const r2 = await runDoctor({ home, targetDir: home });
  assert(r2.checks.find((c) => c.name === 'methodology-home').status === 'pass', 'real home → methodology-home pass');
  assert(r2.checks.find((c) => c.name === 'reviewers-loadable').status === 'pass', 'real reviewers all load');
  assert(Array.isArray(r2.notChecked) && r2.notChecked.length === 2, 'reports its not-checked boundary');
  assert(['pass', 'warn'].includes(r2.status), 'real home is healthy (pass/warn)');

  console.log('doctor self-test: PASS (8 assertions)');
}
