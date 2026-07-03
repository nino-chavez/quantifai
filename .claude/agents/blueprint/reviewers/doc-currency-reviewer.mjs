/**
 * doc-currency-reviewer.mjs — executable pair for doc-currency-reviewer.md.
 * Wave 50: the mechanical half of "docs must stay current" — automates the
 * reference-rot class the 2026-06 manual accuracy sweep (184 docs audited,
 * 33 fixed) caught by hand. Implements the ADR-0002 reviewer contract:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'WARN'|'BLOCKED', findings: [...], metadata: {...} }
 *
 * Three checks:
 *   1. Internal markdown links resolve — `[text](relative/path.md)` whose
 *      target exists neither doc-relative nor repo-root-relative is BLOCK
 *      (mechanically unambiguous rot).
 *   2. Inline-code path citations resolve — `docs/foo.md`-style backtick
 *      citations that look like repo paths but exist nowhere are surfaced as
 *      agent-verified INFO, never WARN/BLOCK: a methodology doc legitimately
 *      cites paths a CONSUMER will create (prescriptive), and prescriptive vs
 *      rotten is a semantic judgment this executable cannot make (the dogfood
 *      proved it — ADR-0004 prescribes `research/personas/` mid-prose in an
 *      otherwise repo-grounded ADR). Noise gates keep the judgment list small:
 *      only paths whose PARENT dir exists here (rot's home turf), ≥2 segments,
 *      not in blockquote lines (the promoted-ADR provenance-note convention),
 *      not in pattern/case-study docs (consumer-tree register by convention).
 *   3. CLI mentions exist — `blueprint <subcommand>` at COMMAND POSITION
 *      (start of a code span or fence line) names a word that actually appears
 *      in bin/blueprint.mjs (target's, else methodology home's). Unknown
 *      subcommand is WARN; no bin found → check skipped with INFO.
 *
 * The INVERSE direction — "a new feature exists but no doc describes it" —
 * is deliberately NOT here: it needs semantic judgment and lives with the
 * Stage-4 validate skill + doc-quality-auditor (same reason that auditor is
 * spec-only). A mechanical version would be noise manufactured into a gate.
 *
 * HONEST SCOPE:
 *   - Scans <targetDir>/docs/**\/*.md (excluding _archive) + root METHODOLOGY.md,
 *     README.md, START-HERE.md, CLAUDE.md. template/ docs are NOT scanned from
 *     the methodology repo — they describe a CONSUMER's tree and are checked
 *     when stamped into one.
 *   - Date-prefixed docs (YYYY-MM-DD-*.md — session logs, audits, handoffs)
 *     are NOT scanned: they are point-in-time records whose citations were
 *     true as of their date. Checking them manufactures permanent rot-noise;
 *     "currency" only applies to living docs.
 *   - Pattern docs (*-pattern.md) and case studies (case-study-*.md) skip the
 *     CITATION check (links still checked): by convention they describe a
 *     CONSUMER's tree — what an adopter creates — not this repo's. A doc that
 *     documents an external tree entirely can opt out with the marker
 *     `<!-- doc-currency: external -->` (skips link + citation checks).
 *   - Fenced code blocks are stripped before link/citation checks (fences are
 *     examples), but ARE scanned for CLI mentions (fences are where commands
 *     live). Anchor fragments (#section) are not validated. Reference-style
 *     links ([x]: path) are not matched.
 *   - Path-citation detection is a shape heuristic: has '/', has an extension
 *     or trailing '/', no spaces/placeholders/URLs/$vars. Extension-less dir
 *     citations (`research/current-state`) are under-checked by design.
 *   - CLI verification is whole-word containment against the bin source, not
 *     an argv parse — a word that appears anywhere in the bin passes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'doc-currency-reviewer';

const ROOT_DOCS = ['METHODOLOGY.md', 'README.md', 'START-HERE.md', 'CLAUDE.md'];
const SKIP_DOC_DIRS = new Set(['_archive', 'node_modules', '.git']);

// The scanned-set declaration the doctor's lint-jurisdiction check diffs
// against the tree's actual prose surfaces (wave 77). Keep in sync with the
// collection logic in review() — this export IS the honest-scope statement.
export const jurisdiction = {
  description: 'internal links + path citations + CLI mentions in living docs',
  roots: ['docs', 'template/docs'],
  rootFiles: ['METHODOLOGY.md', 'README.md', 'START-HERE.md', 'CLAUDE.md'],
  extensions: ['.md'],
  excludes: ['_archive'],
};
const MAX_FINDINGS_PER_CHECK = 30;

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);
const exists = (p) => fs.access(p).then(() => true, () => false);

function result(status, findings, targetSummary, startedAt) {
  return { status, findings, metadata: { reviewer: NAME, targetSummary, durationMs: Date.now() - startedAt } };
}

async function walkDocs(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DOC_DIRS.has(e.name) && !e.name.startsWith('.')) await walkDocs(fp, acc);
    } else if (e.name.endsWith('.md') && !/^\d{4}-\d{2}-\d{2}-/.test(e.name)) {
      acc.push(fp); // date-prefixed docs are point-in-time records — not scanned
    }
  }
  return acc;
}

// --- markdown surgery --------------------------------------------------------

export function stripFences(md) {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
}

export function extractFences(md) {
  const out = [];
  const re = /^(```|~~~)[^\n]*\n([\s\S]*?)^\1\s*$/gm;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[2]);
  return out;
}

// [text](target), [text](target "title"), [text](<target>) — inline links +
// images. Reference-style links are out of scope (see HONEST SCOPE).
export function extractLinks(fencelessMd) {
  const out = [];
  const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m;
  while ((m = re.exec(fencelessMd)) !== null) out.push(m[1]);
  return out;
}

export function extractInlineCode(fencelessMd) {
  const out = [];
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(fencelessMd)) !== null) out.push(m[1]);
  return out;
}

const isExternalLink = (t) => /^(https?:|mailto:|#|\/)/i.test(t) || /[<>{}$*]/.test(t);

export function looksLikeRepoPath(s) {
  if (s.length > 160 || /\s/.test(s) || !s.includes('/')) return false;
  if (/[<>{}$*?|:]/.test(s)) return false; // placeholders, globs, URLs, $vars
  if (/^(~|\/|@)/.test(s)) return false; // home/absolute/scoped-package — outside this repo
  if (/(^|\/)(path\/to|your-|example|node_modules)(\/|$)/i.test(s)) return false;
  return /\.[a-z0-9]{1,6}$/i.test(s) || s.endsWith('/'); // file ext or explicit dir
}

// blueprint <subcommand> mentions at COMMAND POSITION only — the start of a
// line (code spans are joined one-per-line; fence bodies keep their lines),
// optionally behind a prompt char or an npx prefix. This deliberately misses
// mid-sentence mentions and kills the `…/tools/blueprint pull` path-tail and
// "the blueprint strategy" prose false-positive classes.
export function extractCliMentions(codeText) {
  const out = [];
  const re = /^[\s$>]*(?:npx\s+\S+\s+)?blueprint\s+([a-z][a-z-]{2,})\b/;
  for (const line of codeText.split('\n')) {
    const m = re.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

// --- main ----------------------------------------------------------------------

export default async function review({ targetDir, methodologyHome }) {
  const startedAt = Date.now();
  const findings = [];

  // 1. Collect docs. template/docs/** is in scope since wave 77: those are the
  //    consumer-SHIPPED methodology docs — a broken link there stamps into
  //    every consumer, so it is the highest-blast-radius surface this reviewer
  //    covers. (Absent in consumer repos; the walk is a no-op there.)
  const docs = [];
  await walkDocs(path.join(targetDir, 'docs'), docs);
  await walkDocs(path.join(targetDir, 'template', 'docs'), docs);
  for (const f of ROOT_DOCS) {
    const p = path.join(targetDir, f);
    if (await exists(p)) docs.push(p);
  }

  if (docs.length === 0) {
    return result('PASS', [{
      severity: 'INFO',
      location: 'docs/',
      message: 'No docs found to check (no docs/ tree and no root METHODOLOGY/README/START-HERE/CLAUDE.md).',
      remediation: 'None required.',
      reference: 'doc-currency-reviewer.md',
    }], 'docs=0', startedAt);
  }

  // 2. Locate a CLI bin for mention verification (target's own, else the home's).
  let binSrc = null;
  for (const base of [targetDir, methodologyHome].filter(Boolean)) {
    const p = path.join(base, 'bin', 'blueprint.mjs');
    if (await exists(p)) {
      binSrc = await read(p);
      break;
    }
  }

  let brokenLinks = 0;
  let missingCitations = 0;
  let unknownCli = 0;
  let dropped = 0;
  const cap = (n) => {
    if (n >= MAX_FINDINGS_PER_CHECK) {
      dropped += 1;
      return true;
    }
    return false;
  };

  for (const doc of docs) {
    const raw = await read(doc);
    if (raw == null) continue;
    if (raw.includes('<!-- doc-currency: external -->')) continue; // documents an external tree
    const relDoc = path.relative(targetDir, doc);
    const docDir = path.dirname(doc);
    const fenceless = stripFences(raw);
    // Pattern docs + case studies describe a consumer's tree — their path
    // citations are prescriptive, not references into this repo.
    const skipCitations = /-pattern\.md$/.test(doc) || /^case-study-/.test(path.basename(doc));

    // Check 1 — internal markdown links.
    const seenLinks = new Set();
    for (const target of extractLinks(fenceless)) {
      if (isExternalLink(target) || seenLinks.has(target)) continue;
      seenLinks.add(target);
      const clean = target.replace(/#.*$/, '');
      if (!clean) continue; // pure-anchor link
      const tries = [path.join(docDir, clean), path.join(targetDir, clean)];
      let ok = false;
      for (const t of tries) if (await exists(t)) { ok = true; break; }
      if (!ok) {
        if (cap(brokenLinks)) continue;
        brokenLinks += 1;
        findings.push({
          severity: 'BLOCK',
          location: relDoc,
          message: `Broken internal link: (${target}) resolves neither doc-relative nor repo-root-relative.`,
          remediation: 'Update the link to the file\'s current location, or remove it if the target was deleted.',
          reference: 'doc-currency-reviewer.md#1-internal-links-resolve',
        });
      }
    }

    // Check 2 — inline-code path citations (agent-verified; blockquote lines
    // skipped — the promoted-ADR provenance-note convention quotes historical
    // refs there by design).
    const seenPaths = new Set();
    const unresolved = [];
    const citationText = skipCitations
      ? ''
      : fenceless.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
    for (const code of extractInlineCode(citationText)) {
      if (!looksLikeRepoPath(code) || seenPaths.has(code)) continue;
      seenPaths.add(code);
      const clean = code.replace(/\/$/, '');
      if (!clean.includes('/')) continue; // single-segment dirs are too generic
      const tries = [path.join(targetDir, clean), path.join(docDir, clean)];
      let ok = false;
      for (const t of tries) if (await exists(t)) { ok = true; break; }
      if (!ok) {
        // Parent-exists gate: only "file missing from a live dir" is rot we
        // can suspect; a foreign tree's citation has no parent here — skip.
        const parent = path.dirname(clean);
        const parentHere = (await exists(path.join(targetDir, parent))) || (await exists(path.join(docDir, parent)));
        if (!parentHere) continue;
        unresolved.push(code);
      }
    }
    if (unresolved.length > 0) {
      missingCitations += unresolved.length;
      findings.push({
        severity: 'INFO',
        location: relDoc,
        message: `${unresolved.length} unresolved path citation(s) — agent-verified (see .md spec §2): ${unresolved.slice(0, 8).map((c) => `\`${c}\``).join(', ')}${unresolved.length > 8 ? ` (+${unresolved.length - 8} more)` : ''}. Prescriptive-consumer-path vs rotten-reference is a judgment this executable does not make.`,
        remediation: 'Judge each: if the file moved, update the citation; if deleted, rewrite the sentence; if it prescribes a consumer-side path, leave it (or add a placeholder marker for clarity).',
        reference: 'doc-currency-reviewer.md#2-path-citations-resolve',
      });
    }

    // Check 3 — CLI mentions (inline code + fences; fences are where commands live).
    if (binSrc) {
      const codeText = extractInlineCode(fenceless).join('\n') + '\n' + extractFences(raw).join('\n');
      const seenCli = new Set();
      for (const sub of extractCliMentions(codeText)) {
        if (seenCli.has(sub)) continue;
        seenCli.add(sub);
        if (!new RegExp(`\\b${sub}\\b`).test(binSrc)) {
          if (cap(unknownCli)) continue;
          unknownCli += 1;
          findings.push({
            severity: 'WARN',
            location: relDoc,
            message: `CLI mention \`blueprint ${sub}\` — '${sub}' does not appear in bin/blueprint.mjs (containment check; see honest scope).`,
            remediation: 'Fix the documented command name, or implement the subcommand if the doc is ahead of the CLI.',
            reference: 'doc-currency-reviewer.md#3-cli-mentions-exist',
          });
        }
      }
    }
  }

  if (!binSrc) {
    findings.push({
      severity: 'INFO',
      location: 'bin/blueprint.mjs',
      message: 'CLI-mention check SKIPPED: no bin/blueprint.mjs found at the target or the methodology home.',
      remediation: 'None required (consumers without a local bin rely on the published CLI).',
      reference: 'doc-currency-reviewer.md#3-cli-mentions-exist',
    });
  }
  if (dropped > 0) {
    findings.push({
      severity: 'INFO',
      location: '(coverage)',
      message: `${dropped} finding(s) dropped past the per-check cap of ${MAX_FINDINGS_PER_CHECK} — results are a floor, not a census.`,
      remediation: 'Fix the reported batch and re-run.',
      reference: 'doc-currency-reviewer.md#honest-scope',
    });
  }

  const status = findings.some((f) => f.severity === 'BLOCK')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'WARN')
    ? 'WARN'
    : 'PASS';
  const summary = `docs=${docs.length}, broken-links=${brokenLinks}, missing-citations=${missingCitations}, unknown-cli=${unknownCli}${binSrc ? '' : ' (cli-skip)'}`;
  return result(status, findings, summary, startedAt);
}

// ---------------------------------------------------------------------------------
// Self-test — `node doc-currency-reviewer.mjs` exercises the checks against inline
// fixtures and exits non-zero on any failed assertion (matches the libs' pattern).
// ---------------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`ok: ${msg}`);
    }
  };

  // -- pure helpers ------------------------------------------------------------
  assert(stripFences('a\n```js\n[x](gone.md)\n```\nb').indexOf('gone.md') === -1, 'stripFences removes fenced blocks');
  assert(extractFences('```sh\nblueprint doctor\n```')[0].includes('blueprint doctor'), 'extractFences keeps fence bodies');
  assert(extractLinks('[a](x.md) ![img](i.png "t") [b](<y.md>)').join(',') === 'x.md,i.png,y.md', 'extractLinks handles links, images, titles, angle brackets');
  assert(extractInlineCode('see `docs/a.md` and `npm run x`').join(',') === 'docs/a.md,npm run x', 'extractInlineCode finds spans');

  assert(looksLikeRepoPath('docs/foo.md'), 'repo path: docs/foo.md');
  assert(looksLikeRepoPath('apps/portal/'), 'repo path: trailing-slash dir');
  assert(!looksLikeRepoPath('npm run build'), 'not a path: command with spaces');
  assert(!looksLikeRepoPath('research/current-state'), 'not checked: extension-less dir (under-check by design)');
  assert(!looksLikeRepoPath('$BLUEPRINT_HOME/docs/x.md'), 'not a path: $var');
  assert(!looksLikeRepoPath('path/to/file.md'), 'not a path: path/to placeholder');
  assert(!looksLikeRepoPath('apps/<slug>/x.md'), 'not a path: <slug> placeholder');
  assert(!looksLikeRepoPath('https://x.com/y.md'), 'not a path: URL (colon)');
  assert(!looksLikeRepoPath('~/Workspace/dev/x.md'), 'not a path: home-relative');

  assert(
    extractCliMentions('blueprint review --list\n  $ blueprint doctor\nnpx @scope/blueprint-cli init\ngit -C tools/blueprint pull\nthe blueprint strategy').join(',') === 'review,doctor',
    'extractCliMentions: command-position only (path tails + prose excluded)'
  );
  assert(extractCliMentions('blueprint.yml file').length === 0, 'extractCliMentions skips blueprint.yml');

  // -- end-to-end review() over a temp fixture tree ------------------------------
  const os = await import('node:os');
  const fsp = (await import('node:fs')).promises;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'doccur-'));
  const w = (p, s) => fsp
    .mkdir(path.dirname(path.join(tmp, p)), { recursive: true })
    .then(() => fsp.writeFile(path.join(tmp, p), s));

  await w('docs/real.md', '# Real\n');
  await w('src/exists.mjs', 'export const x = 1;\n');
  await w('bin/blueprint.mjs', 'switch (cmd) { case "review": case "doctor": case "init": }\n');
  await w(
    'docs/index.md',
    [
      '[good](real.md) [good-root](docs/real.md) [anchored](real.md#section) [ext](https://example.com/x.md)',
      '[broken](missing.md)',
      '```md\n[fenced-broken](nope.md)\n```',
      'See `src/exists.mjs` and `src/missing.mjs` and `path/to/example.md`.',
      'Foreign trees + bare dirs: `apps/storefront/src/utils/cartUtils.ts` and `worker/` are not flagged.',
      '> Provenance note: `src/quoted-gone.mjs` resolved in the original repo.',
      'Run `blueprint review` and `blueprint frobnicate`.',
      '',
    ].join('\n')
  );
  await w('docs/_archive/old.md', '[ancient](long-gone.md)\n');
  await w('docs/widget-pattern.md', 'Consumers create `docs/widget-spec.md` here.\n');
  await w('docs/external-corpus.md', '<!-- doc-currency: external -->\n[gone](nope.md) `docs/never.md`\n');

  const res = await review({ targetDir: tmp, methodologyHome: null });
  assert(res.status === 'BLOCKED', 'broken internal link → BLOCKED');
  assert(
    res.findings.filter((f) => f.severity === 'BLOCK').length === 1 &&
      /missing\.md/.test(res.findings.find((f) => f.severity === 'BLOCK').message),
    'exactly one broken link flagged (good/anchored/external/fenced all pass)'
  );
  assert(
    res.findings.some((f) => f.severity === 'INFO' && /agent-verified/.test(f.message) && /src\/missing\.mjs/.test(f.message)),
    'missing path citation → agent-verified INFO (never WARN/BLOCK)'
  );
  assert(
    !res.findings.some((f) => /exists\.mjs|example\.md/.test(f.message)),
    'existing + placeholder citations not listed'
  );
  assert(
    !res.findings.some((f) => /cartUtils|worker\/|quoted-gone/.test(f.message)),
    'foreign-tree, single-segment, and blockquoted citations not listed'
  );
  assert(
    res.findings.some((f) => f.severity === 'WARN' && /frobnicate/.test(f.message)),
    'unknown CLI subcommand → WARN'
  );
  assert(!res.findings.some((f) => /`blueprint review`/.test(f.message)), 'known CLI subcommand not flagged');
  assert(!res.findings.some((f) => f.location.includes('_archive')), '_archive docs not scanned');
  assert(!res.findings.some((f) => /widget-spec/.test(f.message)), 'pattern-doc citations skipped (consumer-tree convention)');
  assert(!res.findings.some((f) => f.location.includes('external-corpus')), 'doc-currency: external marker skips the doc entirely');
  assert(res.metadata.reviewer === NAME, 'metadata carries the reviewer name');

  // no bin anywhere → CLI check skipped with INFO, not WARNs.
  await fsp.rm(path.join(tmp, 'bin'), { recursive: true, force: true });
  const noBin = await review({ targetDir: tmp, methodologyHome: path.join(tmp, 'nowhere') });
  assert(
    noBin.findings.some((f) => f.severity === 'INFO' && /CLI-mention check SKIPPED/.test(f.message)),
    'missing bin → CLI check skipped with INFO'
  );
  assert(!noBin.findings.some((f) => /frobnicate/.test(f.message)), 'no CLI WARNs without a bin');

  // clean tree → PASS; missing dir degrades gracefully.
  const clean = await fsp.mkdtemp(path.join(os.tmpdir(), 'doccur-clean-'));
  await fsp.mkdir(path.join(clean, 'docs'), { recursive: true });
  await fsp.writeFile(path.join(clean, 'docs', 'a.md'), 'plain doc, no refs\n');
  const cleanRes = await review({ targetDir: clean, methodologyHome: null });
  assert(['PASS', 'WARN'].includes(cleanRes.status) && !cleanRes.findings.some((f) => f.severity === 'BLOCK'), 'clean tree → no blocks');
  const ghost = await review({ targetDir: path.join(tmp, 'does-not-exist'), methodologyHome: null });
  assert(ghost && ghost.status === 'PASS', 'review degrades gracefully on a missing dir');

  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.rm(clean, { recursive: true, force: true });

  if (process.exitCode) console.error('\ndoc-currency-reviewer self-test FAILED');
  else console.log('\ndoc-currency-reviewer self-test PASSED');
}
