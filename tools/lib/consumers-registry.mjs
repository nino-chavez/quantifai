// consumers-registry.mjs — parse the methodology-side consumers.yml registry and
// classify each consumer's drift from the current methodology version (ADR-0005,
// build-order step 7). Read-only, visibility-only. Dependency-free ESM; matches
// the cost-dial.mjs/telemetry.mjs discipline (no yaml dep, never throws, an
// import.meta.url-guarded --self-test). The grammar here is NEW — a list-of-maps
// block sequence, which cost-dial.mjs does not parse — so the parser is pinned
// explicitly and exercised by the self-test below.
//
// `fleet` computes from the methodology's OWN git history alone — no consumer
// clone (scope ceiling A). consumers.yml is a hand-maintained MIRROR of each
// consumer's authoritative blueprint.yml pin; drift is drift-against-the-mirror.
// See docs/decisions/0005-consumer-registry-and-fleet.md.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// ── Scalar coercion ──────────────────────────────────────────────────────────
function stripInlineComment(s) {
  // Drop a trailing ` # comment` not inside quotes.
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function coerceScalar(raw) {
  let v = stripInlineComment(raw).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// ── Version-shape detectors + semver compare ─────────────────────────────────
export function looksLikeSemver(s) {
  // Optional prerelease (-...) AND optional build metadata (+...), per semver.org —
  // both may appear together (e.g. "1.0.0-alpha+build").
  return typeof s === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(s);
}
export function looksLikeSha(s) {
  // 7–40 hex chars — a git short or full sha. (A 40-char string is unambiguous;
  // 7+ is the conventional short-sha floor.)
  return typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s);
}

export function semverParts(s) {
  // Capture prerelease (group 4) separately from build metadata (group 5).
  // Build metadata is IGNORED for precedence per semver.org; only `pre` is compared.
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(s);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}

/** -1 if a<b, 0 if equal core, 1 if a>b. A prerelease sorts below its release. */
export function semverCmp(a, b) {
  const pa = semverParts(a), pb = semverParts(b);
  if (!pa || !pb) return null;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
  return 0;
}

// ── Registry parser (list-of-maps block sequence) ────────────────────────────
// Grammar:
//   version: <n>                       (optional top-level scalar)
//   consumers:                         (top-level key, column 0)
//     - repo: <id>                     (item start: indented `- ` then first key)
//       pattern: <A|B>                 (sibling fields, indented deeper than `-`)
//       ...
//     - repo: <id2>                    (next item)
// An item with no resolvable `repo` is malformed: dropped AND counted. Duplicate
// `repo` keys: last-wins, recorded in `duplicates`.
export function parseConsumersRegistry(text) {
  const result = { present: true, emptyFile: false, version: null, consumers: [], skippedItems: 0, duplicates: [] };
  // never-throws contract: a non-string (or empty) input degrades to emptyFile,
  // never a `.trim()`/`.split()` crash.
  if (typeof text !== 'string' || text.trim() === '') { result.emptyFile = true; return result; }

  const lines = text.split(/\r?\n/);
  let inConsumers = false;
  let itemIndent = -1;
  const rawItems = [];
  let cur = null;

  const pushField = (key, val) => { if (cur) cur[key] = coerceScalar(val); };

  for (const line of lines) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;

    if (!inConsumers) {
      const ver = /^version:\s*(.+)$/.exec(line);
      if (ver) {
        const v = coerceScalar(ver[1]);
        result.version = /^\d+$/.test(String(v)) ? Number(v) : v; // registry schema version is an int
        continue;
      }
      if (/^consumers:\s*(#.*)?$/.test(line)) { inConsumers = true; continue; }
      continue; // ignore any other top-level scalar before consumers:
    }

    // Inside the consumers: block.
    if (/^\S/.test(line)) break; // dedent to column 0 → sequence ends

    const item = /^(\s*)-\s+([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (item) {
      if (cur) rawItems.push(cur);
      cur = {};
      itemIndent = item[1].length;
      pushField(item[2], item[3]);
      continue;
    }

    const field = /^(\s+)([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (field && field[1].length > itemIndent) {
      pushField(field[2], field[3]);
      continue;
    }
    // Anything else inside the block is ignored (tolerant).
  }
  if (cur) rawItems.push(cur);

  const byRepo = new Map();
  for (const raw of rawItems) {
    const repo = raw.repo;
    if (!repo || typeof repo !== 'string') { result.skippedItems += 1; continue; }
    const entry = {
      repo,
      pattern: raw.pattern ?? null,
      methodology_version: raw.methodology_version ?? null,
      owner: raw.owner ?? null,
      synced_at: raw.synced_at ?? null,
      deprecated_pin: raw.deprecated_pin === true,
      range: raw.range ?? null,
    };
    if (byRepo.has(repo) && !result.duplicates.includes(repo)) result.duplicates.push(repo);
    byRepo.set(repo, entry); // last-wins
  }
  result.consumers = [...byRepo.values()];
  return result;
}

/** Read + parse the registry from a path (never throws; absent → present:false). */
export function readConsumersRegistry(registryPath) {
  let text;
  try {
    text = readFileSync(registryPath, 'utf8');
  } catch {
    return { present: false, emptyFile: false, version: null, consumers: [], skippedItems: 0, duplicates: [] };
  }
  return parseConsumersRegistry(text);
}

// ── Git probe (injectable; real one shells git, never throws) ────────────────
export function makeGitProbe(home) {
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', home, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    headOid() { return git(['rev-parse', 'HEAD']) || null; },
    packageVersion() {
      try { return JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')).version || null; }
      catch { return null; }
    },
    latestSemverTag() {
      const out = git(['tag', '--list', 'v*', '--sort=-v:refname']);
      if (!out) return null;
      const first = out.split('\n')[0].trim();
      return first || null;
    },
    resolveCommit(ref) { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null; },
    isAncestor(anc, desc) {
      try {
        execFileSync('git', ['-C', home, 'merge-base', '--is-ancestor', anc, desc], { stdio: 'ignore' });
        return true;
      } catch { return false; }
    },
    commitDistance(from, to) {
      const out = git(['rev-list', '--count', `${from}..${to}`]);
      const n = out == null ? NaN : Number(out);
      return Number.isFinite(n) ? n : null;
    },
    // `blueprint upgrade` reads these (still all methodology-home git, behind the
    // one injectable probe so the self-test's fake-git seam covers them too).
    commitSubjects(from, to, cap = 40) {
      const out = git(['log', '--format=%h %s', `${from}..${to}`]);
      if (!out) return [];
      return out.split('\n').filter(Boolean).slice(0, cap);
    },
    packageVersionAt(ref) {
      const out = git(['show', `${ref}:package.json`]);
      if (!out) return null; // ref predates package.json, or unreadable
      try { return JSON.parse(out).version || null; } catch { return null; }
    },
  };
}

// ── Resolve the methodology's current version (two anchors by pin shape) ──────
export function resolveCurrent(gitProbe) {
  return {
    version: gitProbe.packageVersion(),
    head: gitProbe.headOid(),
    latestSemverTag: gitProbe.latestSemverTag(),
  };
}

// ── Classify one consumer ────────────────────────────────────────────────────
// Returns { class, distance, distanceUnit, reason, breaking }. Pure function of
// pin SHAPE and intra-shape orderability — never a cross-shape comparison.
//
// `breaking` (the SINGLE source of truth that both `fleet` and `upgrade` read):
//   true  — a `behind` pin crossing a MAJOR boundary (semver: current.major >
//           pin.major; sha: package.json major increased across pin..HEAD).
//   false — a `behind` pin within the same major, or any non-behind class.
//   null  — UNKNOWN: a sha `behind` pin whose package.json major can't be read
//           at the pinned commit (the pin predates package.json, or no version).
//           `upgrade` refuses to auto-apply UNKNOWN without explicit --ack-untagged.
export function classifyConsumer(entry, current, gitProbe) {
  const pin = entry.methodology_version;
  let base;

  if (pin == null) {
    base = { class: 'unpinned', distance: null, distanceUnit: null, reason: 'no methodology_version pin (informational)' };
  } else if (looksLikeSemver(pin)) {
    if (!current.version) {
      base = { class: 'unresolvable', distance: null, distanceUnit: null, reason: 'methodology has no package.json version to compare against' };
    } else {
      const cmp = semverCmp(pin, current.version);
      if (cmp === 0) base = { class: 'current', distance: 0, distanceUnit: 'semver', reason: `pin == ${current.version}` };
      else if (cmp < 0) base = { class: 'behind', distance: null, distanceUnit: 'semver', reason: `${pin} < ${current.version} (no semver tags yet — distance uncounted)` };
      else base = { class: 'ahead', distance: null, distanceUnit: 'semver', reason: `${pin} > ${current.version}` };
    }
  } else if (looksLikeSha(pin)) {
    if (!current.head) {
      // Guard FIRST: without a resolvable methodology HEAD, no sha pin can be
      // placed. Name the probe failure rather than masking it as "off the HEAD
      // line" (not-a-git-repo / broken HEAD / shallow clone with no HEAD).
      base = { class: 'unresolvable', distance: null, distanceUnit: null, reason: 'methodology HEAD unresolvable (not a git repo / broken HEAD) — cannot place sha pin' };
    } else {
      const oid = gitProbe.resolveCommit(pin);
      if (!oid) {
        base = { class: 'unresolvable', distance: null, distanceUnit: null, reason: 'sha not a resolvable commit in methodology history (fork sha, typo, ambiguous prefix, or outside a shallow clone)' };
      } else if (oid === current.head) {
        base = { class: 'current', distance: 0, distanceUnit: 'commits', reason: 'pin resolves to HEAD' };
      } else if (gitProbe.isAncestor(oid, current.head)) {
        base = { class: 'behind', distance: gitProbe.commitDistance(oid, current.head), distanceUnit: 'commits', reason: 'pin is an ancestor of HEAD' };
      } else if (gitProbe.isAncestor(current.head, oid)) {
        base = { class: 'ahead', distance: gitProbe.commitDistance(current.head, oid), distanceUnit: 'commits', reason: 'HEAD is an ancestor of pin (forward of source)' };
      } else {
        base = { class: 'unresolvable', distance: null, distanceUnit: null, reason: 'sha resolves but is off the HEAD line (unrelated history)' };
      }
    }
  } else {
    base = { class: 'unresolvable', distance: null, distanceUnit: null, reason: 'pin is neither valid semver nor a resolvable commit' };
  }

  // breaking — only meaningful for `behind` (the direction upgrade would bump).
  let breaking = false;
  if (base.class === 'behind') {
    if (looksLikeSemver(pin) && current.version) {
      const pp = semverParts(pin), cp = semverParts(current.version);
      breaking = !!(pp && cp && cp.major > pp.major);
    } else if (looksLikeSha(pin)) {
      const atPin = gitProbe.packageVersionAt ? gitProbe.packageVersionAt(pin) : null;
      const cp = current.version ? semverParts(current.version) : null;
      const ap = atPin ? semverParts(atPin) : null;
      breaking = (ap && cp) ? cp.major > ap.major : null; // null = UNKNOWN
    }
  }
  base.breaking = breaking;

  // Deprecation overlays an orderable class (operator-asserted flag only in v1).
  if (entry.deprecated_pin && ['current', 'behind', 'ahead'].includes(base.class)) {
    return { ...base, class: 'on-deprecated', reason: `${base.reason}; entry flagged deprecated_pin` };
  }
  return base;
}

// ── Compute the whole fleet ──────────────────────────────────────────────────
export function computeFleet(home, registryPath, opts = {}) {
  const path = registryPath || join(home, 'consumers.yml');
  const gitProbe = opts.gitProbe || makeGitProbe(home);
  const strict = !!opts.strict;

  const reg = readConsumersRegistry(path);
  const current = resolveCurrent(gitProbe);

  const consumers = reg.consumers.map((entry) => {
    const c = classifyConsumer(entry, current, gitProbe);
    return {
      repo: entry.repo,
      pattern: entry.pattern,
      pin: entry.methodology_version,
      class: c.class,
      distance: c.distance,
      distanceUnit: c.distanceUnit,
      breaking: c.breaking,
      owner: entry.owner,
      syncedAt: entry.synced_at,
      reason: c.reason,
    };
  });

  const tally = (cls) => consumers.filter((c) => c.class === cls).length;
  const summary = {
    current: tally('current'),
    behind: tally('behind'),
    ahead: tally('ahead'),
    onDeprecated: tally('on-deprecated'),
    unpinned: tally('unpinned'),
    unresolvable: tally('unresolvable'),
    total: consumers.length,
  };
  const warnings = { skippedItems: reg.skippedItems, duplicates: reg.duplicates, emptyFile: reg.emptyFile };

  const driftPresent =
    summary.behind + summary.onDeprecated + summary.unresolvable > 0 ||
    reg.skippedItems > 0 ||
    reg.duplicates.length > 0 ||
    (strict && summary.ahead > 0);

  return { present: reg.present, emptyFile: reg.emptyFile, blueprintHome: home, current, consumers, summary, warnings, driftPresent };
}

// ── Self-test (node consumers-registry.mjs --self-test) ──────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };

  // Shape detectors + semver compare.
  assert(looksLikeSemver('0.1.0') && looksLikeSemver('1.2.3-rc.1'), 'semver detector');
  assert(!looksLikeSemver('010945a') && looksLikeSha('010945a'), 'sha detector');
  assert(!looksLikeSha('nope') && !looksLikeSemver('010945a'), 'sha/semver mutually exclusive for a sha');
  assert(semverCmp('0.1.0', '0.2.0') === -1 && semverCmp('1.0.0', '1.0.0') === 0 && semverCmp('2.0.0', '1.9.9') === 1, 'semverCmp core');
  assert(semverCmp('1.0.0-rc.1', '1.0.0') === -1, 'prerelease sorts below release');
  assert(looksLikeSemver('1.0.0-alpha+build') && looksLikeSemver('1.0.0+build') && looksLikeSemver('1.0.0-rc.1'), 'semver allows prerelease AND build metadata together');
  assert(semverCmp('1.0.0-alpha+build', '1.0.0+other') === -1, 'build metadata ignored for precedence; prerelease still sorts low');

  // Parser: a well-formed registry.
  const REG = `version: 1
consumers:
  - repo: nino-chavez/rally-hq
    pattern: B
    methodology_version: null         # unpinned
    owner: nino-chavez
    synced_at: "2026-06-04"
  - repo: nino-chavez/blueprint-platform
    pattern: A
    methodology_version: "010945a"
    owner: nino-chavez
    synced_at: "2026-06-04"
`;
  const p = parseConsumersRegistry(REG);
  assert(p.present && !p.emptyFile && p.version === 1, 'registry header parsed');
  assert(p.consumers.length === 2, 'two consumers parsed');
  assert(p.consumers[0].repo === 'nino-chavez/rally-hq' && p.consumers[0].methodology_version === null, 'unpinned entry');
  assert(p.consumers[1].methodology_version === '010945a' && p.consumers[1].pattern === 'A', 'sha-pinned entry + inline comment stripped');

  // Parser: empty + absent + malformed + duplicate.
  assert(parseConsumersRegistry('   \n\n').emptyFile === true, 'empty file flagged');
  assert(parseConsumersRegistry(42).emptyFile === true && parseConsumersRegistry({}).emptyFile === true && parseConsumersRegistry(null).emptyFile === true, 'non-string input degrades (never throws)');
  assert(readConsumersRegistry('/no/such/consumers.yml').present === false, 'absent file → present:false');
  const mal = parseConsumersRegistry('consumers:\n  - pattern: A\n    owner: x\n  - repo: a/b\n    owner: y\n');
  assert(mal.skippedItems === 1 && mal.consumers.length === 1, 'item missing repo skipped + counted');
  const dup = parseConsumersRegistry('consumers:\n  - repo: a/b\n    pattern: A\n  - repo: a/b\n    pattern: B\n');
  assert(dup.duplicates.length === 1 && dup.consumers.length === 1 && dup.consumers[0].pattern === 'B', 'duplicate repo: last-wins + recorded');

  // Parser: tab-indent + CRLF tolerance.
  const tabReg = 'consumers:\r\n\t- repo: a/b\r\n\t  owner: z\r\n';
  const tp = parseConsumersRegistry(tabReg);
  assert(tp.consumers.length === 1 && tp.consumers[0].repo === 'a/b', 'tab-indent + CRLF parsed');

  // Classifier with an injected fake git probe.
  const HEAD = 'f'.repeat(40);
  const ANCESTOR = 'a'.repeat(40);
  const FORWARD = 'b'.repeat(40);
  const fakeGit = {
    headOid: () => HEAD,
    packageVersion: () => '0.1.0',
    latestSemverTag: () => null,
    resolveCommit: (ref) => {
      if (ref === '010945a' || ref === ANCESTOR) return ANCESTOR;
      if (ref === 'deadbee' || ref === FORWARD) return FORWARD;
      if (ref === 'fffffff' || ref === HEAD) return HEAD;
      return null; // unresolvable
    },
    isAncestor: (a, b) => (a === ANCESTOR && b === HEAD) || (a === HEAD && b === FORWARD) || a === b,
    commitDistance: (from, to) => (from === ANCESTOR && to === HEAD ? 23 : from === HEAD && to === FORWARD ? 5 : 0),
    // `upgrade` probes (added with the breaking field).
    commitSubjects: (from, to) => (from === ANCESTOR && to === HEAD ? ['abc123 feat(x): a', 'def456 fix(y): b'] : []),
    packageVersionAt: (ref) => (ref === ANCESTOR ? null : ref === FORWARD ? '0.1.0' : null), // ANCESTOR predates package.json → UNKNOWN
  };
  const cur = resolveCurrent(fakeGit);
  const cls = (entry) => classifyConsumer(entry, cur, fakeGit);

  assert(cls({ methodology_version: null }).class === 'unpinned', 'null pin → unpinned');
  assert(cls({ methodology_version: '0.1.0' }).class === 'current', 'semver == version → current');
  assert(cls({ methodology_version: '0.0.9' }).class === 'behind', 'semver < version → behind');
  assert(cls({ methodology_version: '0.2.0' }).class === 'ahead', 'semver > version → ahead');
  const shaBehind = cls({ methodology_version: '010945a' });
  assert(shaBehind.class === 'behind' && shaBehind.distance === 23 && shaBehind.distanceUnit === 'commits', 'sha ancestor → behind 23 commits');
  assert(cls({ methodology_version: 'fffffff' }).class === 'current', 'sha == HEAD → current (checked before ancestry)');
  assert(cls({ methodology_version: 'deadbee' }).class === 'ahead' && cls({ methodology_version: 'deadbee' }).distance === 5, 'sha forward → ahead 5');
  assert(cls({ methodology_version: 'ccccccc' }).class === 'unresolvable', 'sha not in repo → unresolvable');
  assert(cls({ methodology_version: 'not-a-version' }).class === 'unresolvable', 'garbage pin → unresolvable');
  assert(cls({ methodology_version: '010945a', deprecated_pin: true }).class === 'on-deprecated', 'deprecated flag overlays orderable class');
  assert(cls({ methodology_version: null, deprecated_pin: true }).class === 'unpinned', 'deprecated flag does NOT overlay unpinned');

  // breaking field (the single source of truth fleet + upgrade share).
  assert(cls({ methodology_version: '0.0.9' }).breaking === false, 'semver behind same major → breaking:false');
  assert(cls({ methodology_version: '0.1.0' }).breaking === false, 'current → breaking:false');
  // A semver pin two majors back (current 0.1.0 has major 0, so force a major bump via a higher-major current).
  const v2cur = { version: '2.0.0', head: HEAD, latestSemverTag: null };
  assert(classifyConsumer({ methodology_version: '1.5.0' }, v2cur, fakeGit).breaking === true, 'semver behind crossing major → breaking:true');
  assert(classifyConsumer({ methodology_version: '2.0.0-rc.1' }, v2cur, fakeGit).breaking === false, 'same-major prerelease behind → breaking:false');
  // sha behind whose pin predates package.json (packageVersionAt → null) → breaking UNKNOWN (null).
  assert(shaBehind.breaking === null, 'sha behind, pin predates package.json → breaking:null (UNKNOWN)');

  // Null-HEAD (not-a-git-repo / broken HEAD): a sha pin is unresolvable with a
  // reason that names the probe failure, not a masked "off the HEAD line".
  const noHeadCur = { version: '0.1.0', head: null, latestSemverTag: null };
  const noHead = classifyConsumer({ methodology_version: '010945a' }, noHeadCur, fakeGit);
  assert(noHead.class === 'unresolvable' && /HEAD unresolvable/.test(noHead.reason), 'sha pin + null HEAD → unresolvable naming the probe failure');
  assert(classifyConsumer({ methodology_version: '0.0.9' }, noHeadCur, fakeGit).class === 'behind', 'semver pin still classifiable with null HEAD (only needs version)');

  // computeFleet: drift + exit semantics via a registry path stub. Drive it by
  // injecting the fake probe and a registry built in-memory through a temp file.
  const os = await import('node:os');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(join(os.tmpdir(), 'bp-fleet-'));
  const regPath = join(dir, 'consumers.yml');
  writeFileSync(regPath, REG);
  const fleet = computeFleet(dir, regPath, { gitProbe: fakeGit });
  assert(fleet.summary.unpinned === 1 && fleet.summary.behind === 1, 'fleet tallies: 1 unpinned + 1 behind');
  assert(fleet.driftPresent === true, 'a behind consumer → driftPresent (exit 1)');

  // Clean fleet: only unpinned + current + ahead → no drift.
  writeFileSync(regPath, 'consumers:\n  - repo: a/b\n    methodology_version: null\n  - repo: c/d\n    methodology_version: "0.1.0"\n');
  assert(computeFleet(dir, regPath, { gitProbe: fakeGit }).driftPresent === false, 'unpinned + current → clean (exit 0)');

  // Structural suspicion: malformed item forces non-clean even with no behind.
  writeFileSync(regPath, 'consumers:\n  - pattern: A\n    owner: x\n');
  assert(computeFleet(dir, regPath, { gitProbe: fakeGit }).driftPresent === true, 'all-malformed registry → driftPresent (no false-green)');

  // --strict folds ahead into drift.
  writeFileSync(regPath, 'consumers:\n  - repo: a/b\n    methodology_version: "0.2.0"\n');
  assert(computeFleet(dir, regPath, { gitProbe: fakeGit }).driftPresent === false, 'ahead not drift by default');
  assert(computeFleet(dir, regPath, { gitProbe: fakeGit, strict: true }).driftPresent === true, '--strict: ahead counts as drift');

  console.log('consumers-registry self-test: PASS (39 assertions)');
}
