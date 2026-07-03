// upgrade.mjs — the `blueprint upgrade` engine (ADR-0005, build-order step 8).
// The DOWN channel of the bidirectional update protocol, consumer-local:
// `upgrade` is `fleet` for ONE consumer (it reuses consumers-registry.mjs's
// classifier verbatim) plus a delta narrative plus a gated, dirty-tree-guarded
// pin-bump. Default is a DRY-RUN preview (terraform plan); --apply is the write
// (terraform apply). v1 is pin-bump only — chrome re-stamp stays the separate,
// explicit `stamp.mjs --mode=restamp-chrome` step (deferred; see the ADR).
//
// Dependency-free ESM, never-throws discipline. Reads CHANGELOG.md, never writes
// it (Changesets owns it). The only write is the single methodology_version line.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { looksLikeSemver, looksLikeSha, semverCmp } from './consumers-registry.mjs';

function safeRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// ── CHANGELOG parsing (dependency-free; split on `## <semver>` headers) ───────
export function parseChangelogSections(text) {
  if (typeof text !== 'string') return [];
  const sections = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/.exec(line);
    if (m) { if (cur) sections.push(cur); cur = { version: m[1], body: '' }; }
    else if (cur) cur.body += line + '\n';
  }
  if (cur) sections.push(cur);
  return sections.map((s) => ({ version: s.version, body: s.body.trim() }));
}

/**
 * Narrate what changed between a consumer's pin and the current methodology.
 * Returns { kind: 'changelog'|'commitlog'|'none', entries: string[] }. Never
 * fabricates a CHANGELOG section: when no released sections sit in range, it
 * degrades to the methodology commit log (sha pins), labeled by the caller.
 */
export function narrateChangelogDelta({ home, pin, current, verdictClass, gitProbe }) {
  if (['current', 'unpinned', 'unresolvable'].includes(verdictClass)) return { kind: 'none', entries: [] };

  if (looksLikeSemver(pin) && current.version) {
    const text = safeRead(join(home, 'CHANGELOG.md'));
    if (text) {
      const inRange = parseChangelogSections(text).filter(
        (s) => semverCmp(pin, s.version) === -1 && (semverCmp(s.version, current.version) === -1 || semverCmp(s.version, current.version) === 0)
      );
      if (inRange.length) return { kind: 'changelog', entries: inRange.map((s) => `## ${s.version}\n${s.body}`.trim()) };
    }
    // no sections in range → fall through to commit-log if a sha range exists
  }

  if (looksLikeSha(pin) && current.head && gitProbe.commitSubjects) {
    const subs = gitProbe.commitSubjects(pin, current.head);
    if (subs.length) return { kind: 'commitlog', entries: subs };
  }
  return { kind: 'none', entries: [] };
}

// ── The apply gate (pure; keyed on the shared classifier's class + breaking) ──
// action ∈ apply | insert | noop | refuse-breaking | refuse-ahead |
//          refuse-unresolvable | refuse-untagged
export function computeGate(verdict, opts = {}) {
  const cls = verdict.class;
  const breaking = verdict.breaking;
  if (cls === 'current') return { action: 'noop', message: 'already current — nothing to do' };
  if (cls === 'unpinned') return { action: 'insert', message: 'unpinned — --apply will add a methodology_version pin to blueprint.yml' };
  if (cls === 'ahead') return { action: 'refuse-ahead', message: 'pin is ahead of source; upgrade does not roll back — resolve manually' };
  if (cls === 'unresolvable') return { action: 'refuse-unresolvable', message: 'pin does not resolve in methodology history (fork sha / typo); cannot compute a safe target' };
  // behind (or on-deprecated overlaying behind)
  if (breaking === true) return { action: 'refuse-breaking', message: 'MAJOR (breaking) bump — review the CHANGELOG migration note, then bump methodology_version by hand' };
  if (breaking === null) {
    return opts.ackUntagged
      ? { action: 'apply', message: 'breaking-ness UNKNOWN (no semver tags in range) — applying per --ack-untagged' }
      : { action: 'refuse-untagged', message: 'breaking-ness UNKNOWN — no semver tags in range to gate on; re-run with --ack-untagged to apply anyway, or wait for a vX.Y.Z release' };
  }
  return { action: 'apply', message: 'non-breaking (same major) — safe to bump the pin' };
}

// ── Surgical pin write (only under --apply, gate passed, tree clean) ──────────
// Anchored to a column-0 `methodology_version:` line (distinct from
// `methodology_home:`), replaces the VALUE only (keeps a trailing comment), and
// asserts the value round-trips. blueprint.yml is evidence — a malformed write is
// a durability violation, so a failed round-trip returns ok:false.
const PIN_RE = /^(methodology_version:[ \t]*)("?[^"#\s]+"?)([ \t]*#.*)?$/m;

function pinValueInText(text) {
  const m = PIN_RE.exec(text);
  return m ? m[2].replace(/^["']|["']$/g, '') : null;
}

export function bumpPin(targetDir, from, to) {
  const file = join(targetDir, 'blueprint.yml');
  const text = safeRead(file);
  if (text == null) return { ok: false, mode: null, before: null, error: 'cannot read blueprint.yml' };

  const all = text.match(new RegExp(PIN_RE.source, 'mg')) || [];
  let next, mode, before;

  if (from != null) {
    if (all.length !== 1) return { ok: false, mode: 'replace', before: null, error: `expected exactly one methodology_version line, found ${all.length}` };
    before = all[0];
    mode = 'replace';
    // Function replacement → `to` is spliced LITERALLY (a string replacement would
    // interpret `$1`/`$&` in `to` as backreferences; a sha/semver never contains
    // `$`, but splice literally as a matter of write-safety).
    next = text.replace(PIN_RE, (_m, p1, _p2, p3) => `${p1}"${to}"${p3 || ''}`);
  } else {
    // insert (unpinned consumer): a single column-0 line, appended.
    if (all.length > 0) return { ok: false, mode: 'insert', before: null, error: 'methodology_version already present; use replace' };
    // readYamlScalar reads an INDENTED methodology_version (it trims), but the
    // column-0 PIN_RE won't — inserting would create a duplicate the reader then
    // shadows. Refuse rather than write a confusing second line.
    if (/^[ \t]+methodology_version[ \t]*:/m.test(text)) {
      return { ok: false, mode: 'insert', before: null, error: 'methodology_version present but not at column 0 — fix its indentation, then re-run' };
    }
    mode = 'insert';
    before = null;
    next = text.replace(/\n*$/, '') + `\nmethodology_version: "${to}"\n`;
  }

  // Atomic write: stage to a temp file, verify the round-trip on the staged
  // content, and only rename into place on success — a failed write leaves the
  // original blueprint.yml pristine (it is evidence; a half-write is a durability
  // violation).
  if (pinValueInText(next) !== to) return { ok: false, mode, before, error: 'pin did not round-trip on staged content — blueprint.yml left unchanged' };
  const tmp = `${file}.blueprint-tmp`;
  try {
    writeFileSync(tmp, next);
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* temp may not exist */ }
    return { ok: false, mode, before, error: `write failed: ${e.message}` };
  }
  return { ok: true, mode, before };
}

// ── git guards on the CONSUMER repo (targetDir, not the methodology home) ─────
export function isDirty(targetDir, files = ['blueprint.yml']) {
  try {
    const out = execFileSync('git', ['-C', targetDir, 'status', '--porcelain', '--', ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().length > 0;
  } catch {
    return false; // not a git repo → nothing to discard; don't block (no revert story anyway)
  }
}
export function isTracked(targetDir, file = 'blueprint.yml') {
  try { execFileSync('git', ['-C', targetDir, 'ls-files', '--error-unmatch', file], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Self-test (node upgrade.mjs --self-test) ─────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };

  // parseChangelogSections
  const CL = `# Changelog\n\n## 0.3.0\nthird\n\n## 0.2.0\nsecond\n\n## 0.1.0\nfirst\n`;
  const secs = parseChangelogSections(CL);
  assert(secs.length === 3 && secs[0].version === '0.3.0' && secs[0].body === 'third', 'changelog sections parsed in order');
  assert(parseChangelogSections(null).length === 0, 'parseChangelogSections never throws on non-string');

  // narrateChangelogDelta — commitlog path (sha pin) via fake probe.
  const fakeGit = { commitSubjects: (from, to) => ['abc fix: a', 'def feat: b'] };
  const cur = { version: '0.1.0', head: 'f'.repeat(40), latestSemverTag: null };
  const commit = narrateChangelogDelta({ home: '/nope', pin: '010945a', current: cur, verdictClass: 'behind', gitProbe: fakeGit });
  assert(commit.kind === 'commitlog' && commit.entries.length === 2, 'sha behind → commitlog narration');
  const none = narrateChangelogDelta({ home: '/nope', pin: 'f'.repeat(40), current: cur, verdictClass: 'current', gitProbe: fakeGit });
  assert(none.kind === 'none', 'current → none');

  // computeGate — every branch.
  assert(computeGate({ class: 'current' }).action === 'noop', 'current → noop');
  assert(computeGate({ class: 'unpinned' }).action === 'insert', 'unpinned → insert');
  assert(computeGate({ class: 'ahead' }).action === 'refuse-ahead', 'ahead → refuse-ahead');
  assert(computeGate({ class: 'unresolvable' }).action === 'refuse-unresolvable', 'unresolvable → refuse-unresolvable');
  assert(computeGate({ class: 'behind', breaking: true }).action === 'refuse-breaking', 'behind+breaking → refuse-breaking');
  assert(computeGate({ class: 'behind', breaking: false }).action === 'apply', 'behind+non-breaking → apply');
  assert(computeGate({ class: 'behind', breaking: null }).action === 'refuse-untagged', 'behind+UNKNOWN → refuse-untagged');
  assert(computeGate({ class: 'behind', breaking: null }, { ackUntagged: true }).action === 'apply', 'behind+UNKNOWN+ack → apply');

  // bumpPin — replace, insert, multi-match refusal, round-trip, comment preserved.
  const os = await import('node:os');
  const { mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(join(os.tmpdir(), 'bp-upgrade-'));
  const file = join(dir, 'blueprint.yml');

  writeFileSync(file, 'name: x\nmethodology_version: "010945a"  # a comment\ntier: 2\n');
  const r1 = bumpPin(dir, '010945a', 'd7a3706');
  assert(r1.ok && r1.mode === 'replace', 'replace ok');
  assert(/methodology_version: "d7a3706"  # a comment/.test(readFileSync(file, 'utf8')), 'value replaced, trailing comment preserved');
  assert(/^name: x/m.test(readFileSync(file, 'utf8')) && /tier: 2/.test(readFileSync(file, 'utf8')), 'other lines untouched');

  // methodology_home must NOT be clobbered by the anchored regex.
  writeFileSync(file, 'methodology_home: /some/path\nmethodology_version: "0.1.0"\n');
  bumpPin(dir, '0.1.0', '0.2.0');
  assert(/methodology_home: \/some\/path/.test(readFileSync(file, 'utf8')), 'methodology_home not clobbered');
  assert(/methodology_version: "0.2.0"/.test(readFileSync(file, 'utf8')), 'methodology_version bumped');

  // insert (unpinned).
  writeFileSync(file, 'name: y\ntier: 1\n');
  const r2 = bumpPin(dir, null, '0.1.0');
  assert(r2.ok && r2.mode === 'insert', 'insert ok');
  assert(/^methodology_version: "0.1.0"$/m.test(readFileSync(file, 'utf8')), 'inserted at column 0');

  // multi-match refusal.
  writeFileSync(file, 'methodology_version: "a"\nmethodology_version: "b"\n');
  const r3 = bumpPin(dir, 'a', 'c');
  assert(!r3.ok && /found 2/.test(r3.error), 'two pin lines → refuse with count');

  // `$`-bearing target spliced LITERALLY (regex backreference-injection guard).
  writeFileSync(file, 'methodology_version: "0.1.0"\n');
  bumpPin(dir, '0.1.0', 'x$1$&y');
  assert(/methodology_version: "x\$1\$&y"/.test(readFileSync(file, 'utf8')), '$-bearing pin written literally, not interpreted as backreference');

  // indented methodology_version + insert → refuse (don't create a duplicate the reader shadows).
  writeFileSync(file, 'meta:\n  methodology_version: "z"\n');
  const r4 = bumpPin(dir, null, '0.1.0');
  assert(!r4.ok && /not at column 0/.test(r4.error), 'indented pin + insert → refuse');

  // cannot read.
  assert(bumpPin(join(dir, 'nope'), 'a', 'b').ok === false, 'missing blueprint.yml → ok:false');

  console.log('upgrade self-test: PASS (23 assertions)');
}
