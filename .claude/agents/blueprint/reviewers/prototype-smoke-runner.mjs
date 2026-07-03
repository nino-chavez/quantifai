/**
 * prototype-smoke-runner.mjs — executable pair for the paired .md spec. The
 * Stage 6 SHIP gate (ADR-0002 reviewer contract) so the smoke gate runs in
 * CI / CLI / any node, outside Claude Code:
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Gate rule (the v3 portal CSS-gap, 2026-05-25 — see
 * docs/case-studies/case-study-v3-portal-css-gap.md): a 200 from curl is not enough and a
 * green @smoke suite is not enough; both are blind to unstyled chrome. This gate
 * boots the prototype, runs @smoke, captures viewport screenshots, and verifies
 * every JS-emitted class name has a CSS rule. The share-link MUST NOT release on
 * any failure (STATUS=BLOCKED). Stage 7 (iterate) is where human feedback lands;
 * Stage 6 is where the agent verifies its own work passes.
 *
 * SCOPE — what this executable .mjs does vs. what the agent variant (.md,
 * tools: [Read, Glob, Bash]) does. The two share the spec; they do NOT do the
 * same work, and the difference is stated here rather than over-claimed:
 *
 *   STATIC (this file, dependency-free node, never throws):
 *     - scope gate (variant: greenfield/midstream mandatory; brownfield only
 *       with a substantive prototype/portal artifact)
 *     - serve.sh existence (BLOCK if absent)
 *     - @smoke spec discovery + Playwright install presence (BLOCK if specs
 *       missing or Playwright absent — never installs anything itself)
 *     - JS class-literal ↔ CSS-selector coverage diff (the I-5 check — the
 *       core encoded value of this gate; the one thing static analysis CAN do
 *       fully and the exact failure the v3 gap shipped)
 *     - page enumeration (the screenshot WORKLIST: what a live runner would
 *       shoot), surfaced as evidence, not executed
 *
 *   LIVE (the .md agent, or an opt-in --execute run; NOT done here by default):
 *     - actually `bash serve.sh &`, poll the port, run `npx playwright test
 *       --grep @smoke`, drive browse-tool to screenshot each page, tear down.
 *     This file does NOT boot a server or spawn Playwright in the default
 *     review() path: a conformance reviewer invoked by `blueprint review` /
 *     `blueprint doctor` must be a fast, side-effect-free static gate (it runs
 *     in CI against many consumers). Booting + screenshotting is an
 *     environment-bound runtime action the agent owns. Where this file cannot
 *     PROVE the runtime passed, it says so in a WARN finding rather than
 *     fabricating a green boot/smoke/screenshot result.
 *
 * Dependency-free node ESM. No npm deps. Hand-scans files via line/regex (the
 * cost-dial.mjs idiom) — no YAML/JSON dep for blueprint.yml.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'prototype-smoke-runner';

// JS class-literal allow-list: emitted classes that legitimately have no CSS
// rule in the shipping stylesheet (framework/runtime hooks, not visual chrome).
// The spec: "BLOCK on any JS-emitted class without a matching CSS rule unless
// explicitly allow-listed."
const CSS_COVERAGE_ALLOWLIST = new Set([
  'hidden', 'active', 'open', 'is-open', 'is-active', 'visible', 'show',
  'sr-only', 'loading', 'loaded', 'selected', 'current', 'disabled',
]);

// JS shell modules the spec names explicitly, plus any sibling *shell* module.
const NAMED_JS_SHELLS = ['proto-nav.js', '_portal-shell.js', 'chat-widget.js', 'proto-annotate.js'];

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

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

// ── dep-free helpers (exported for the self-test) ────────────────────────────

// Line-scan blueprint.yml for `variant:` — no yaml dep, same idiom as readTier
// in bin/blueprint.mjs and the cost-dial block parser.
export function readVariant(text) {
  if (!text) return null;
  for (const line of text.split('\n')) {
    const m = /^\s*variant:\s*([A-Za-z_-]+)/.exec(line);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// Line-scan for a declared port. Accepts `port: 8080`, a localhost URL with a
// port, or `--port 8080` (as it would appear in serve.sh). Best-effort; the
// port is informational here (the live runner uses it to poll), so a miss is a
// note, not a block.
export function readPort(...texts) {
  for (const text of texts) {
    if (!text) continue;
    for (const line of text.split('\n')) {
      let m = /^\s*port:\s*([0-9]{2,5})/.exec(line);
      if (m) return Number(m[1]);
      m = /localhost:([0-9]{2,5})/.exec(line);
      if (m) return Number(m[1]);
      m = /--port[=\s]+([0-9]{2,5})/.exec(line);
      if (m) return Number(m[1]);
      // `python3 -m http.server <port>` / `http-server -p <port>` positional.
      m = /http\.server\s+([0-9]{2,5})/.exec(line);
      if (m) return Number(m[1]);
      m = /-p\s+([0-9]{2,5})/.exec(line);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

// Extract class-name string literals emitted by JS shell modules. We scan for
// the shapes that actually emit DOM classes — never the whole quoted-string
// universe (that would flood the diff with copy text). Covered:
//   - className = "a b c"  /  className += " x"
//   - classList.add('x', 'y') / .toggle('x') / .remove('x') / .contains('x')
//   - setAttribute('class', 'a b')
//   - template-literal class="..." in innerHTML / string returns
// Returns a Set of individual class tokens.
export function extractJsClasses(js) {
  if (!js) return new Set();
  const out = new Set();
  const addTokens = (raw) => {
    for (const tok of raw.split(/\s+/)) {
      const t = tok.trim();
      // Drop template-literal interpolations (${...}) and non-class noise.
      if (!t || t.includes('${') || t.includes('{') || t.includes('}')) continue;
      if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(t)) out.add(t);
    }
  };

  // className = "..." | className += "..."
  for (const m of js.matchAll(/className\s*\+?=\s*(['"`])([^'"`]*)\1/g)) addTokens(m[2]);
  // classList.add/toggle/remove/replace/contains('a', 'b', ...)
  for (const m of js.matchAll(/classList\.(?:add|toggle|remove|replace|contains)\s*\(([^)]*)\)/g)) {
    for (const lit of m[1].matchAll(/(['"`])([^'"`]*)\1/g)) addTokens(lit[2]);
  }
  // setAttribute('class', '...')
  for (const m of js.matchAll(/setAttribute\s*\(\s*(['"`])class\1\s*,\s*(['"`])([^'"`]*)\2/g)) addTokens(m[3]);
  // class="..." inside template strings / innerHTML
  for (const m of js.matchAll(/class\s*=\s*(['"`])([^'"`]*)\1/g)) addTokens(m[2]);

  return out;
}

// Extract simple class selector names (.foo) from a CSS stylesheet. We strip
// comments first, then pull every `.identifier` token. This is a SUPERSET (it
// also catches descendant/compound selectors) which is exactly right for a
// coverage check: we only ask "does a rule mention this class", not "is the
// selector shaped a particular way".
export function extractCssSelectors(css) {
  if (!css) return new Set();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Set();
  for (const m of noComments.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  return out;
}

// Diff JS-emitted classes against CSS selectors; allow-listed tokens never count
// as missing. Returns the sorted list of classes with no CSS rule.
export function diffCoverage(jsClasses, cssSelectors, allowlist = CSS_COVERAGE_ALLOWLIST) {
  const missing = [];
  for (const c of jsClasses) {
    if (allowlist.has(c)) continue;
    if (!cssSelectors.has(c)) missing.push(c);
  }
  return missing.sort();
}

// ── filesystem walkers ───────────────────────────────────────────────────────

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
      if (e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.astro' && e.name !== '.git') {
        await walk(fp, acc);
      }
    } else {
      acc.push(fp);
    }
  }
  return acc;
}

// Locate the prototype shell root: prefer prototype/, then portal/, then
// apps/portal/, then blueprint/portal/. Returns the first that exists.
async function findShellDir(targetDir) {
  for (const rel of ['prototype', 'portal', path.join('apps', 'portal'), path.join('blueprint', 'portal')]) {
    const p = path.join(targetDir, rel);
    if (await exists(p)) return { dir: p, rel };
  }
  return null;
}

// Enumerate the pages a live runner would screenshot (the worklist). Sources, in
// the spec's order: portal _meta/index.json, prototype scripts/list-pages.sh,
// then a glob of pages/ dirs and top-level *.html. We do NOT navigate them — we
// report the count as the screenshot worklist evidence.
async function enumeratePages(targetDir, shell, allFiles) {
  const pages = new Set();

  // _meta/index.json (portal shell) — JSON.parse guarded; degrade silently.
  const metaIndex = path.join(targetDir, '_meta', 'index.json');
  const metaText = await read(metaIndex);
  if (metaText) {
    try {
      const j = JSON.parse(metaText);
      const arr = Array.isArray(j) ? j : Array.isArray(j.pages) ? j.pages : [];
      for (const entry of arr) {
        const v = typeof entry === 'string' ? entry : entry && (entry.path || entry.href || entry.page);
        if (v) pages.add(String(v));
      }
    } catch {
      /* malformed _meta/index.json — fall through to globbing */
    }
  }

  // scripts/list-pages.sh (prototype shell) — presence only; we cannot safely
  // execute it in a static gate. Note its existence as a worklist source.
  const listScript = path.join(targetDir, 'scripts', 'list-pages.sh');
  const hasListScript = await exists(listScript);

  // glob pages/ directories + top-level *.html across the shell and target.
  for (const f of allFiles) {
    if (!f.endsWith('.html')) continue;
    const rel = path.relative(targetDir, f);
    if (rel.split(path.sep).includes('pages') || path.dirname(rel) === '.' ||
        (shell && f.startsWith(shell.dir))) {
      pages.add(rel);
    }
  }

  return { pages: [...pages].sort(), hasListScript };
}

// ── the gate ─────────────────────────────────────────────────────────────────

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  let ymlText = null;
  try {
    ymlText = await read(path.join(targetDir, 'blueprint.yml'));
  } catch {
    ymlText = null;
  }
  const variant = readVariant(ymlText) || (blueprintYml && blueprintYml.variant) || null;

  // 1. SCOPE GATE.
  const shell = await findShellDir(targetDir);
  if (variant === 'research') {
    return result('PASS', [], 'research — out of scope for this variant (no prototype to smoke-test)', startedAt);
  }
  if (variant === 'brownfield') {
    // Brownfield runs only if there's a substantive prototype/portal artifact.
    let substantive = false;
    if (shell) {
      const shellFiles = await walk(shell.dir);
      substantive = shellFiles.some((f) => /\.(html|astro|tsx|js|css)$/.test(f));
    }
    if (!substantive) {
      return result('PASS', [], 'brownfield, no prototype artifact — gate not applicable', startedAt);
    }
  } else if (variant && variant !== 'greenfield' && variant !== 'midstream') {
    // Unknown variant string — don't fabricate a verdict; surface and continue
    // as if mandatory (fail-safe toward gating, not toward shipping).
    findings.push({
      severity: 'WARN',
      location: 'blueprint.yml variant',
      message: `Unrecognized variant '${variant}' — treating the smoke gate as mandatory (greenfield/midstream policy).`,
      remediation: 'Set variant to greenfield | midstream | brownfield in blueprint.yml.',
      reference: 'docs/variant-selection.md',
    });
  }
  // variant === null also proceeds as mandatory — absence of a declared variant
  // is itself a problem the upstream gates catch; here we just run the checks.

  // 2. serve.sh existence.
  const serveSh = path.join(targetDir, 'serve.sh');
  const serveText = await read(serveSh);
  if (serveText == null) {
    findings.push({
      severity: 'BLOCK',
      location: 'serve.sh',
      message: 'No boot script (serve.sh) at initiative root — the Stage 0 reference recipe assumes one; the prototype cannot be booted or smoke-tested.',
      remediation: 'Add a serve.sh that serves the prototype/portal on a declared port (claim the next free port). See docs/context/browser-legibility.md.',
      reference: 'prototype-smoke-runner.md#2-verify-the-local-boot-script-exists',
    });
  }

  const port = readPort(serveText, ymlText);
  if (serveText != null && port == null) {
    findings.push({
      severity: 'WARN',
      location: 'serve.sh',
      message: 'serve.sh present but no port could be read from it or blueprint.yml — a live boot cannot poll for reachability without a known port.',
      remediation: 'Declare the port explicitly in serve.sh (e.g. `--port 8080`) or in blueprint.yml so the runner can curl http://localhost:<port>.',
      reference: 'prototype-smoke-runner.md#3-boot-the-prototype',
    });
  }

  // 3. @smoke spec discovery + Playwright presence.
  const allFiles = await walk(targetDir);
  const specFiles = allFiles.filter((f) => /\.(spec|test)\.(ts|js|mjs|tsx|jsx)$/.test(f) || /\/tests?\//.test(f) && /\.(ts|js|mjs)$/.test(f));
  let smokeSpecCount = 0;
  for (const f of specFiles) {
    const c = await read(f);
    if (c && /@smoke/.test(c)) smokeSpecCount += 1;
  }
  if (smokeSpecCount === 0) {
    findings.push({
      severity: 'BLOCK',
      location: 'tests/ (or prototype/tests/, playwright.config testDir)',
      message: 'No @smoke-tagged Playwright specs found — the smoke suite is missing. Stage 2 should have defined a happy-path-per-flow smoke suite (testing baseline).',
      remediation: "Add at least one Playwright spec tagged @smoke covering each top-level flow's happy path, then re-run. The suite is intentionally narrow (not exhaustive E2E).",
      reference: 'prototype-smoke-runner.md#4-run-the-smoke-suite',
    });
  }

  // Playwright presence — installed dep or a config file. The gate never
  // installs it; it BLOCKs with a setup hint (spec rule).
  const hasPwConfig = allFiles.some((f) => /(^|\/)playwright\.config\.(ts|js|mjs|cjs)$/.test(f));
  let hasPwDep = await exists(path.join(targetDir, 'node_modules', '@playwright', 'test'));
  if (!hasPwDep) hasPwDep = await exists(path.join(targetDir, 'node_modules', 'playwright'));
  if (!hasPwDep) {
    let pkg = {};
    try {
      pkg = JSON.parse((await read(path.join(targetDir, 'package.json'))) || '{}');
    } catch {
      pkg = {};
    }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    hasPwDep = Boolean(deps['@playwright/test'] || deps['playwright']);
  }
  if (smokeSpecCount > 0 && !hasPwDep && !hasPwConfig) {
    findings.push({
      severity: 'BLOCK',
      location: 'package.json / playwright.config',
      message: 'Playwright not installed (no @playwright/test dependency and no playwright.config). @smoke specs exist but cannot run.',
      remediation: 'Install Playwright in the initiative (`npm i -D @playwright/test && npx playwright install`). The gate does not install it for you.',
      reference: 'prototype-smoke-runner.md#rules',
    });
  }

  // 4. JS class output ↔ CSS coverage check (per invariant I-5) — the core
  //    encoded value of this gate (the exact v3 CSS-gap failure).
  let jsShellFiles = [];
  let cssFiles = [];
  if (shell) {
    const shellFiles = await walk(shell.dir);
    jsShellFiles = shellFiles.filter(
      (f) => NAMED_JS_SHELLS.includes(path.basename(f)) || /shell.*\.js$/.test(path.basename(f)),
    );
    cssFiles = shellFiles.filter((f) => f.endsWith('.css'));
  }
  // Also catch a top-level shared.css the spec names explicitly.
  for (const candidate of ['shared.css', path.join('prototype', 'shared.css'), path.join('portal', 'shared.css')]) {
    const p = path.join(targetDir, candidate);
    if (!cssFiles.includes(p) && (await exists(p))) cssFiles.push(p);
  }

  if (jsShellFiles.length === 0) {
    // No JS shell modules → nothing to diff. Don't claim a pass we didn't earn.
    findings.push({
      severity: 'WARN',
      location: shell ? `${shell.rel}/` : 'prototype/ | portal/',
      message: 'No JS shell modules (proto-nav.js / _portal-shell.js / chat-widget.js / *shell*.js) found — the JS↔CSS coverage check had nothing to diff. If the prototype emits classes from JS, the gate could not see it.',
      remediation: 'Confirm the prototype has no JS-emitted classes (a fully static shell is fine), or point the shell modules at the conventional names so the coverage check can run.',
      reference: 'prototype-smoke-runner.md#6-js-class-output--css-coverage-check',
    });
  } else {
    const jsClasses = new Set();
    for (const f of jsShellFiles) {
      for (const c of extractJsClasses(await read(f))) jsClasses.add(c);
    }
    const cssSelectors = new Set();
    let cssText = '';
    for (const f of cssFiles) {
      const c = (await read(f)) || '';
      cssText += '\n' + c;
    }
    for (const s of extractCssSelectors(cssText)) cssSelectors.add(s);

    const missing = diffCoverage(jsClasses, cssSelectors);
    if (cssFiles.length === 0) {
      findings.push({
        severity: 'BLOCK',
        location: shell ? `${shell.rel}/` : 'prototype/',
        message: `JS shell modules emit ${jsClasses.size} class name(s) but no shipping stylesheet (shared.css or equivalent) was found to cover them — every emitted class is unstyled chrome.`,
        remediation: 'Add the shipping stylesheet (shared.css) and ensure every JS-emitted class has a CSS rule. This is the v3 portal CSS-gap failure mode.',
        reference: 'docs/case-studies/case-study-v3-portal-css-gap.md',
      });
    } else if (missing.length) {
      findings.push({
        severity: 'BLOCK',
        location: cssFiles.map((f) => path.relative(targetDir, f)).slice(0, 3).join(', '),
        message: `${missing.length} JS-emitted class(es) have no CSS rule (unstyled chrome): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ` (+${missing.length - 12} more)` : ''}.`,
        remediation: `Add a CSS rule for each, or add the class to the gate's allow-list if it is a framework/runtime hook with no visual surface. This is exactly the v3 portal CSS-gap (curl 200 + @smoke green, but visibly unstyled).`,
        reference: 'docs/case-studies/case-study-v3-portal-css-gap.md',
      });
    }
  }

  // 5. Page enumeration (screenshot worklist evidence). We report what a live
  //    runner WOULD shoot; we do not navigate/screenshot in this static path.
  const { pages, hasListScript } = await enumeratePages(targetDir, shell, allFiles);

  // 6. LIVE-action honesty. This static gate did NOT boot the server, run
  //    Playwright, or capture screenshots. Surface that as a single WARN so the
  //    review record never reads as a proven-green runtime when it wasn't.
  const liveBits = [];
  if (serveText != null) liveBits.push('boot serve.sh + poll port');
  if (smokeSpecCount > 0 && (hasPwDep || hasPwConfig)) liveBits.push(`run ${smokeSpecCount} @smoke spec(s)`);
  liveBits.push(`screenshot ${pages.length} page(s)${hasListScript ? ' (incl. scripts/list-pages.sh output)' : ''}`);
  findings.push({
    severity: 'WARN',
    location: 'runtime',
    message: `Static gate only — NOT executed here: ${liveBits.join('; ')}. A green static gate is necessary but not sufficient for the share-link release; the live boot + @smoke run + screenshot capture is the agent variant's (or a deploy-stage runner's) job.`,
    remediation: `Run the live verification before releasing the share-link: \`bash serve.sh &\`, poll http://localhost:${port ?? '<port>'}, \`npx playwright test --grep @smoke\`, then browse-tool screenshot each page into .smoke-screenshots/, then kill the boot process. See prototype-smoke-runner.md.`,
    reference: 'prototype-smoke-runner.md',
  });

  const summary = `variant=${variant ?? 'unknown'}, serve.sh=${serveText != null ? 'yes' : 'no'}, @smoke=${smokeSpecCount}, pages=${pages.length}, css-diff=${jsShellFiles.length ? 'run' : 'skipped'}`;
  return finalize(findings, summary, startedAt);
}

// ── self-test ────────────────────────────────────────────────────────────────
// `node prototype-smoke-runner.mjs` exercises the pure helpers + the full review()
// against inline fixture dirs, and exits non-zero on the first failed assertion.
if (import.meta.url === `file://${process.argv[1]}`) {
  const os = await import('node:os');
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  // — pure helpers —
  assert(readVariant('variant: greenfield\ntier: 1\n') === 'greenfield', 'readVariant greenfield');
  assert(readVariant('  variant:   Midstream  # note\n') === 'midstream', 'readVariant midstream lowercased');
  assert(readVariant('tier: 0\n') === null, 'readVariant absent → null');

  assert(readPort('port: 8080\n') === 8080, 'readPort yaml port');
  assert(readPort('serve the build\n', 'go http://localhost:5050') === 5050, 'readPort localhost url (2nd text)');
  assert(readPort('serve --port 9090\n') === 9090, 'readPort --port flag');
  assert(readPort('python3 -m http.server 8080\n') === 8080, 'readPort http.server positional');
  assert(readPort('http-server -p 4173\n') === 4173, 'readPort -p flag');
  assert(readPort('no port here\n') === null, 'readPort none → null');

  const js = `
    el.className = "nav-bar  nav-bar--sticky";
    other.classList.add('chat-widget', 'chat-widget--open');
    node.setAttribute('class', 'proto-annotate');
    return \`<div class="lane-card hidden">\${title}</div>\`;
    bad.className = \`row-\${i}\`; // interpolation must be dropped
  `;
  const jsClasses = extractJsClasses(js);
  for (const c of ['nav-bar', 'nav-bar--sticky', 'chat-widget', 'chat-widget--open', 'proto-annotate', 'lane-card', 'hidden']) {
    assert(jsClasses.has(c), `extractJsClasses has ${c}`);
  }
  assert(![...jsClasses].some((c) => c.includes('${') || c.startsWith('row')), 'extractJsClasses drops interpolated literals');

  const css = `
    /* comment .ignored-in-comment {} */
    .nav-bar { color: red; }
    .nav-bar--sticky, .lane-card { position: sticky; }
    .chat-widget.chat-widget--open { display: block; }
    .proto-annotate { outline: 1px; }
  `;
  const sels = extractCssSelectors(css);
  assert(sels.has('nav-bar') && sels.has('lane-card') && sels.has('chat-widget--open'), 'extractCssSelectors pulls class names');
  assert(!sels.has('ignored-in-comment'), 'extractCssSelectors strips comments');

  // Full coverage → no missing (hidden is allow-listed).
  assert(diffCoverage(jsClasses, sels).length === 0, 'diffCoverage full coverage → empty');
  // Drop a rule → that class is reported missing.
  const partial = new Set([...sels]);
  partial.delete('lane-card');
  assert(diffCoverage(jsClasses, partial).includes('lane-card'), 'diffCoverage reports the uncovered class');
  // Allow-listed token never counts as missing even with empty CSS.
  assert(diffCoverage(new Set(['hidden', 'active']), new Set()).length === 0, 'diffCoverage allow-list shields framework hooks');

  // — review() against fixture dirs —
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-runner-'));
  // mk(root, rel, body) writes a file under a specific fixture root, creating
  // parent dirs. (Rooting at a per-fixture dir is load-bearing: a shared root
  // would leak files across fixtures.)
  const mk = async (root, rel, body) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  };

  // Fixture A — brownfield, no prototype → PASS (gate not applicable).
  const bf = path.join(tmp, 'brownfield');
  await fs.mkdir(bf, { recursive: true });
  await fs.writeFile(path.join(bf, 'blueprint.yml'), 'variant: brownfield\ntier: 0\n');
  const rBf = await review({ targetDir: bf, blueprintYml: { tier: 0 } });
  assert(rBf.status === 'PASS', `brownfield-no-prototype → PASS (got ${rBf.status})`);

  // Fixture B — greenfield, no serve.sh, no smoke specs → BLOCKED with both.
  const bare = path.join(tmp, 'bare');
  await fs.mkdir(bare, { recursive: true });
  await fs.writeFile(path.join(bare, 'blueprint.yml'), 'variant: greenfield\ntier: 1\n');
  const rBare = await review({ targetDir: bare, blueprintYml: { tier: 1 } });
  assert(rBare.status === 'BLOCKED', `bare greenfield → BLOCKED (got ${rBare.status})`);
  assert(rBare.findings.some((f) => f.location === 'serve.sh' && f.severity === 'BLOCK'), 'bare → serve.sh BLOCK');
  assert(rBare.findings.some((f) => /@smoke/.test(f.message) && f.severity === 'BLOCK'), 'bare → missing @smoke BLOCK');

  // Fixture C — greenfield, serve.sh + @smoke spec + Playwright dep + a portal
  // shell whose JS emits a class the CSS does NOT cover → BLOCKED on CSS gap.
  const gap = path.join(tmp, 'cssgap');
  await mk(gap, 'blueprint.yml', 'variant: greenfield\ntier: 1\n');
  await mk(gap, 'serve.sh', '#!/usr/bin/env bash\npython3 -m http.server 8080\n');
  await mk(gap, 'package.json', JSON.stringify({ devDependencies: { '@playwright/test': '^1' } }));
  await mk(gap, 'tests/home.spec.ts', "import { test } from '@playwright/test';\ntest('@smoke home loads', async () => {});\n");
  await mk(gap, 'portal/proto-nav.js', "el.className = 'nav-bar nav-bar--orphan';\n");
  await mk(gap, 'portal/shared.css', '.nav-bar { color: black; }\n'); // nav-bar--orphan uncovered
  const rGap = await review({ targetDir: gap, blueprintYml: { tier: 1 } });
  assert(rGap.status === 'BLOCKED', `css-gap → BLOCKED (got ${rGap.status})`);
  assert(
    rGap.findings.some((f) => f.severity === 'BLOCK' && /nav-bar--orphan/.test(f.message)),
    'css-gap → BLOCK names the uncovered class',
  );
  // Same fixture must NOT block on serve.sh or @smoke (those are satisfied).
  assert(!rGap.findings.some((f) => f.location === 'serve.sh' && f.severity === 'BLOCK'), 'css-gap → serve.sh satisfied');
  assert(!rGap.findings.some((f) => /@smoke/.test(f.message) && f.severity === 'BLOCK'), 'css-gap → @smoke satisfied');

  // Fixture D — same as C but CSS covers the class → no CSS BLOCK; the only
  // remaining finding is the live-action WARN → status WARN (not BLOCKED).
  const ok = path.join(tmp, 'covered');
  await mk(ok, 'blueprint.yml', 'variant: greenfield\ntier: 1\n');
  await mk(ok, 'serve.sh', '#!/usr/bin/env bash\npython3 -m http.server 8080\n');
  await mk(ok, 'package.json', JSON.stringify({ devDependencies: { '@playwright/test': '^1' } }));
  await mk(ok, 'tests/home.spec.ts', "test('@smoke ok', async () => {});\n");
  await mk(ok, 'portal/proto-nav.js', "el.className = 'nav-bar';\n");
  await mk(ok, 'portal/shared.css', '.nav-bar { color: black; }\n');
  await mk(ok, 'index.html', '<!doctype html><html></html>\n');
  const rOk = await review({ targetDir: ok, blueprintYml: { tier: 1 } });
  assert(rOk.status === 'WARN', `covered greenfield → WARN (live-action only) (got ${rOk.status})`);
  assert(!rOk.findings.some((f) => f.severity === 'BLOCK'), 'covered → no BLOCK findings');
  assert(rOk.findings.some((f) => f.location === 'runtime'), 'covered → carries the live-action WARN');
  assert(/pages=/.test(rOk.metadata.targetSummary), 'covered → summary reports page worklist');

  await fs.rm(tmp, { recursive: true, force: true });
  console.log('prototype-smoke-runner self-test: all assertions passed');
}
