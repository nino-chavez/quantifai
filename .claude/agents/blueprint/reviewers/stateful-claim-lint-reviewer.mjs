/**
 * stateful-claim-lint-reviewer.mjs — executable pair for stateful-claim-lint-reviewer.md.
 * Wave 59: the mechanical half of "stateful claims rot." Promoted past the
 * second-instance rule on the 2026-06-10/11 evidence: "forty-nine waves
 * captured in CLAUDE.md" (5 waves stale), HANDOFF's "Latest wave (49)",
 * and the charter's "at rest as of wave 54" + "0.1.0 on npm" — every
 * instance operator-caught, none gate-caught. Hardcoded counts/versions in
 * prose drift from their sources of truth; this lints the drift.
 *
 * ADR-0002 reviewer contract:
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'WARN'|'BLOCKED', findings: [...], metadata: {...} }
 *
 * Five checks — each locates its source of truth and SKIPS (INFO) when the
 * source is absent, so the reviewer is safe in consumer repos that have no
 * wave log or registry:
 *   1. wave-currency  — currency-asserting wave claims ("Current state: wave N",
 *      "latest wave (N)", "N waves of changes", "all N waves", incl. number-
 *      words like "forty-nine") vs max `- Wave N` in WAVE-LOG.md. Mismatch is
 *      BLOCK: these patterns unambiguously assert "now".
 *   2. consumer-count — "N consumers" / "N registered" vs `- repo:` entries in
 *      consumers.yml. WARN (prose counts are sometimes legitimately historical).
 *   3. reviewer-count — "reviewer fleet: N" / "N reviewers" vs canonical specs
 *      (*.md minus README) in the reviewers dir. WARN.
 *   4. doctor-checks  — "doctor ... N checks" (doctor named on the same line)
 *      vs distinct add('<name>') calls in doctor.mjs. WARN.
 *   5. version-pin    — "<pkg>@X.Y.Z" in prose vs package.json version. WARN;
 *      whether that version is LIVE on npm is agent-verified (no network here).
 *
 * HONEST SCOPE:
 *   - Scans living reader/operator docs only: root README/METHODOLOGY/
 *     CONTRIBUTING/CLAUDE/HANDOFF/START-HERE(.md if present), docs/**, and
 *     template/CLAUDE.md. NOT scanned: WAVE-LOG.md and METHODOLOGY-AMENDMENTS.md
 *     (append-only records — their claims were true at writing), feedback/**,
 *     docs/_archive/**, docs/case-studies/**, docs/decisions/** (ADRs are
 *     point-in-time records), date-prefixed docs.
 *   - Fenced code blocks are stripped first: fences hold example output, and
 *     example output legitimately contains frozen counts.
 *   - Claim DETECTION is regex over prose; novel phrasings of currency claims
 *     are under-matched by design — tight patterns keep the gate honest. The
 *     judgment variant ("does this paragraph imply currency?") is agent-verified
 *     territory, not manufactured here.
 *   - Number-words are mapped for one..ninety-nine; beyond that, digits only.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'stateful-claim-lint-reviewer';

const ROOT_DOCS = ['README.md', 'METHODOLOGY.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'HANDOFF.md', 'START-HERE.md'];
const SKIP_DIRS = new Set(['_archive', 'case-studies', 'decisions', 'node_modules', '.git']);
const EXCLUDE_FILES = new Set(['WAVE-LOG.md', 'METHODOLOGY-AMENDMENTS.md']);
const MAX_FINDINGS = 40;

// The scanned-set declaration the doctor's lint-jurisdiction check diffs
// against the tree's actual prose surfaces (wave 77). Keep in sync with the
// doc-collection logic in review() — this export IS the honest-scope statement.
export const jurisdiction = {
  description: 'count/version/currency claims in living operator docs',
  roots: ['docs'],
  rootFiles: [...ROOT_DOCS, 'template/CLAUDE.md'],
  extensions: ['.md'],
  excludes: [...SKIP_DIRS].filter((d) => d !== 'node_modules' && d !== '.git'),
};

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

// ── number words (one..ninety-nine) ──────────────────────────────────────────
const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordToNum(w) {
  const s = w.toLowerCase();
  if (s in UNITS) return UNITS[s];
  if (s in TENS) return TENS[s];
  const m = s.match(/^([a-z]+)-([a-z]+)$/);
  if (m && m[1] in TENS && m[2] in UNITS) return TENS[m[1]] + UNITS[m[2]];
  return null;
}
const NUMWORD = '(?:\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
function toNum(tok) {
  return /^\d+$/.test(tok) ? parseInt(tok, 10) : wordToNum(tok);
}

const stripFences = (s) => s.replace(/^```[\s\S]*?^```/gm, '');

// ── doc collection (mirrors doc-currency's living-docs scope) ─────────────────
async function walkDocs(dir, acc = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walkDocs(path.join(dir, e.name), acc);
    } else if (e.name.endsWith('.md') && !EXCLUDE_FILES.has(e.name) && !/^\d{4}-\d{2}-\d{2}-/.test(e.name)) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

async function collectDocs(targetDir) {
  const docs = [];
  for (const f of ROOT_DOCS) {
    const p = path.join(targetDir, f);
    if ((await read(p)) !== null && !EXCLUDE_FILES.has(f)) docs.push(p);
  }
  docs.push(...(await walkDocs(path.join(targetDir, 'docs'))));
  const tplClaude = path.join(targetDir, 'template', 'CLAUDE.md');
  if ((await read(tplClaude)) !== null) docs.push(tplClaude);
  return docs;
}

// ── sources of truth ──────────────────────────────────────────────────────────
async function maxWave(targetDir, home) {
  for (const base of [targetDir, home]) {
    const s = await read(path.join(base, 'WAVE-LOG.md'));
    if (s === null) continue;
    let max = null;
    for (const m of s.matchAll(/^- Wave (\d+)/gm)) max = Math.max(max ?? 0, parseInt(m[1], 10));
    if (max !== null) return max;
  }
  return null;
}

async function consumerCount(targetDir, home) {
  for (const base of [targetDir, home]) {
    const s = await read(path.join(base, 'consumers.yml'));
    if (s === null) continue;
    return (s.match(/^\s*- repo:/gm) || []).length;
  }
  return null;
}

async function reviewerCounts(home) {
  const dir = path.join(home, 'template', '.claude', 'agents', 'blueprint', 'reviewers');
  let entries;
  try { entries = await fs.readdir(dir); } catch { return null; }
  const specs = entries.filter((f) => f.endsWith('.md') && f !== 'README.md');
  const executables = entries.filter((f) => f.endsWith('.mjs'));
  return { specs: specs.length, executables: executables.length };
}

async function doctorChecksCount(home) {
  const s = await read(path.join(home, 'template', 'tools', 'lib', 'doctor.mjs'));
  if (s === null) return null;
  const names = new Set();
  for (const m of s.matchAll(/\badd\('([a-z-]+)'/g)) names.add(m[1]);
  return names.size || null;
}

async function pkgVersion(targetDir, home) {
  for (const base of [targetDir, home]) {
    const s = await read(path.join(base, 'package.json'));
    if (s === null) continue;
    try {
      const { name, version } = JSON.parse(s);
      if (name && version) return { name, version };
    } catch { /* fall through */ }
  }
  return null;
}

// ── the review ────────────────────────────────────────────────────────────────
export default async function review({ targetDir, methodologyHome }) {
  const startedAt = Date.now();
  const home = methodologyHome || targetDir;
  const findings = [];
  const counters = { docs: 0, claims: 0, mismatches: 0, skippedChecks: [] };

  const docs = await collectDocs(targetDir);
  counters.docs = docs.length;

  const [wave, consumers, fleet, doctorChecks, pkg] = await Promise.all([
    maxWave(targetDir, home), consumerCount(targetDir, home), reviewerCounts(home), doctorChecksCount(home), pkgVersion(targetDir, home),
  ]);
  for (const [k, v] of [['wave-currency', wave], ['consumer-count', consumers], ['reviewer-count', fleet], ['doctor-checks', doctorChecks], ['version-pin', pkg]]) {
    if (v === null) counters.skippedChecks.push(k);
  }

  const addFinding = (severity, file, line, check, claimed, actual, excerpt) => {
    counters.mismatches++;
    if (findings.length >= MAX_FINDINGS) return;
    findings.push({
      severity, check, file, line,
      message: `${check}: claims ${claimed}, source of truth says ${actual} — "${excerpt.trim().slice(0, 120)}"`,
      fix: 'Update the claim, or rephrase to point at the source of truth instead of freezing a value.',
    });
  };

  // Currency-asserting wave patterns. Historical refs ("in wave 49", "since
  // wave 45") deliberately do NOT match.
  const WAVE_PATTERNS = [
    new RegExp(`current state:?\\*{0,2}\\s+wave\\s+(${NUMWORD})`, 'gi'),
    new RegExp(`latest wave\\s*\\(?(${NUMWORD})\\)?`, 'gi'),
    new RegExp(`(${NUMWORD})\\s+waves of (?:changes|methodology)`, 'gi'),
    new RegExp(`all\\s+(${NUMWORD})\\s+waves`, 'gi'),
  ];
  // Registry-count claims only: the line must be registry-flavored, the number
  // must not be a fragment of a longer token (ADR ids like "0005"), and
  // "consumer-registry"-style compounds must not match.
  const CONSUMER_PATTERNS = [
    new RegExp(`(?<![\\d-])(${NUMWORD})\\s+(?:registered\\s+)?consumers?\\b(?!['’-])`, 'gi'),
    new RegExp(`consumers?:?\\s+(${NUMWORD})\\s+registered`, 'gi'),
  ];
  const CONSUMER_LINE_FLAVOR = /consumers\.yml|registry|registered|fleet/i;
  const FLEET_PATTERNS = [
    new RegExp(`reviewer fleet(?:\\s+is)?(?:\\s+now)?:?\\s+(${NUMWORD})(?:\\s*\\((${NUMWORD})\\s+executable)?`, 'gi'),
    new RegExp(`fleet now\\s+(${NUMWORD})`, 'gi'),
  ];
  // "doctor" must sit within 50 chars BEFORE "N checks" — same-line co-occurrence
  // is too weak for long single-line paragraphs (the charter's current-state
  // chain false-positived on a historical "four checks" 500 chars from doctor).
  const DOCTOR_PATTERN = new RegExp(`doctor[^\\n]{0,50}?(?:runs\\s+)?(${NUMWORD})\\s+checks`, 'gi');

  for (const docPath of docs) {
    const raw = await read(docPath);
    if (raw === null) continue;
    const body = stripFences(raw);
    const rel = path.relative(targetDir, docPath);
    const lines = body.split('\n');

    lines.forEach((lineText, i) => {
      const lineNo = i + 1;

      if (wave !== null) {
        for (const re of WAVE_PATTERNS) {
          re.lastIndex = 0;
          for (const m of lineText.matchAll(re)) {
            counters.claims++;
            const n = toNum(m[1]);
            if (n !== null && n !== wave) addFinding('BLOCK', rel, lineNo, 'wave-currency', `wave ${n}`, `wave ${wave}`, m[0]);
          }
        }
      }

      if (consumers !== null && CONSUMER_LINE_FLAVOR.test(lineText)) {
        for (const re of CONSUMER_PATTERNS) {
          re.lastIndex = 0;
          for (const m of lineText.matchAll(re)) {
            counters.claims++;
            const n = toNum(m[1]);
            if (n !== null && n !== consumers) addFinding('WARN', rel, lineNo, 'consumer-count', `${n} consumers`, `${consumers} in consumers.yml`, m[0]);
          }
        }
      }

      if (fleet !== null) {
        for (const re of FLEET_PATTERNS) {
          re.lastIndex = 0;
          for (const m of lineText.matchAll(re)) {
            counters.claims++;
            const n = toNum(m[1]);
            if (n !== null && n !== fleet.specs) addFinding('WARN', rel, lineNo, 'reviewer-count', `${n} reviewers`, `${fleet.specs} canonical specs`, m[0]);
            const ex = m[2] !== undefined ? toNum(m[2]) : null;
            if (ex !== null && ex !== fleet.executables) addFinding('WARN', rel, lineNo, 'reviewer-count', `${ex} executable`, `${fleet.executables} .mjs executables`, m[0]);
          }
        }
      }

      if (doctorChecks !== null) {
        DOCTOR_PATTERN.lastIndex = 0;
        for (const m of lineText.matchAll(DOCTOR_PATTERN)) {
          counters.claims++;
          const n = toNum(m[1]);
          if (n !== null && n !== doctorChecks) addFinding('WARN', rel, lineNo, 'doctor-checks', `${n} checks`, `${doctorChecks} distinct checks in doctor.mjs`, m[0]);
        }
      }

      // Deliberate old-version mentions ("npm deprecate <pkg>@OLD") are not
      // stale pins — skip deprecation-flavored lines.
      if (pkg !== null && lineText.includes(`${pkg.name}@`) && !/deprecat/i.test(lineText)) {
        const re = new RegExp(`${pkg.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}@(\\d+\\.\\d+\\.\\d+)`, 'g');
        for (const m of lineText.matchAll(re)) {
          counters.claims++;
          if (m[1] !== pkg.version) addFinding('WARN', rel, lineNo, 'version-pin', `${pkg.name}@${m[1]}`, `package.json says ${pkg.version}`, m[0]);
        }
      }
    });
  }

  if (counters.skippedChecks.length) {
    findings.push({
      severity: 'INFO', check: 'scope',
      message: `Checks skipped (source of truth absent): ${counters.skippedChecks.join(', ')}. Whether a pinned version is LIVE on npm is agent-verified (no network in this reviewer).`,
    });
  }

  const hasBlock = findings.some((f) => f.severity === 'BLOCK');
  const hasWarn = findings.some((f) => f.severity === 'WARN');
  const status = hasBlock ? 'BLOCKED' : hasWarn ? 'WARN' : 'PASS';
  const summary = `docs=${counters.docs}, claims-checked=${counters.claims}, mismatches=${counters.mismatches}, skipped=[${counters.skippedChecks.join(',')}]`;
  return { status, findings, metadata: { reviewer: NAME, targetSummary: summary, durationMs: Date.now() - startedAt } };
}

// ── Self-test (node stateful-claim-lint-reviewer.mjs --self-test) ─────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const os = await import('node:os');
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  let n = 0;
  const ok = (cond, msg) => { assert(cond, msg); n++; };

  ok(wordToNum('forty-nine') === 49 && wordToNum('twelve') === 12 && wordToNum('ninety') === 90 && wordToNum('zebra') === null, 'number-word mapping');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-'));
  const w = (rel, s) => fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true }).then(() => fs.writeFile(path.join(tmp, rel), s));

  // Sources of truth: max wave 57, 3 consumers, package 1.2.3.
  await w('WAVE-LOG.md', '- Wave 56 — x\n- Wave 57 — y\n');
  await w('consumers.yml', 'consumers:\n  - repo: a/a\n  - repo: b/b\n  - repo: c/c\n');
  await w('package.json', JSON.stringify({ name: '@x/cli', version: '1.2.3' }));

  // Drifted claims, one per check class + number-word + historical non-claim.
  await w('CLAUDE.md', '**Current state:** wave 55 — stale.\nIn wave 49 we shipped hive (historical — must not match).\n');
  await w('README.md', 'forty-nine waves of changes captured here.\nThe registry (consumers.yml) lists 12 consumers.\nInstall @x/cli@0.9.9 today.\nRun npm deprecate @x/cli@0.0.1 to retire the old line.\n');
  await w('docs/guide.md', 'Latest wave (50) did things.\n```\nexample output: 99 consumers\n```\n');

  let r = await review({ targetDir: tmp, methodologyHome: tmp });
  ok(r.status === 'BLOCKED', `drifted wave claims → BLOCKED (got ${r.status})`);
  const checks = r.findings.map((f) => f.check);
  ok(r.findings.filter((f) => f.check === 'wave-currency' && f.severity === 'BLOCK').length === 3, `three wave-currency blocks (got ${r.findings.filter((f) => f.check === 'wave-currency').length})`);
  ok(checks.includes('consumer-count'), 'consumer-count drift found');
  ok(checks.includes('version-pin'), 'version-pin drift found');
  ok(!r.findings.some((f) => f.check === 'wave-currency' && f.file === 'CLAUDE.md' && f.line === 2), 'historical "in wave 49" not matched');
  ok(!r.findings.some((f) => (f.message || '').includes('99 consumers')), 'fenced example output not matched');

  // Corrected claims → PASS.
  await w('CLAUDE.md', '**Current state:** wave 57 — current.\n');
  await w('README.md', 'fifty-seven waves of changes. The registry has 3 consumers. Install @x/cli@1.2.3.\n');
  await w('docs/guide.md', 'Latest wave (57).\n');
  r = await review({ targetDir: tmp, methodologyHome: tmp });
  ok(r.status === 'PASS', `corrected claims → PASS (got ${r.status}: ${JSON.stringify(r.findings[0] || null)})`);

  // Consumer repo with no sources of truth → PASS with skip INFO, never throws.
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'scl2-'));
  await fs.writeFile(path.join(tmp2, 'README.md'), 'We are on wave 99 of greatness; the registry lists 400 consumers.\n');
  r = await review({ targetDir: tmp2, methodologyHome: tmp2 });
  ok(r.status === 'PASS' && r.findings.some((f) => f.check === 'scope'), 'absent sources → checks skip, PASS + INFO');

  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(tmp2, { recursive: true, force: true });
  console.log(`stateful-claim-lint-reviewer self-test: PASS (${n} assertions)`);
}
