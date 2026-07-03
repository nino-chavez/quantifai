/**
 * portal-initiative-conformance-reviewer.mjs — executable pair for the paired
 * .md spec. Implements the ADR-0002 reviewer contract so the Initiative Portal portal
 * conformance gate runs outside Claude Code (CLI / CI / any node).
 *
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'BLOCKED'|'WARN', findings: [...], metadata: {...} }
 *
 * Each finding carries a `remediation` string (Lopopolo injection pattern) so an
 * agent reading the output can act on it directly. See the paired .md for the
 * full rationale behind each of the 8 checks. Dependency-free node ESM.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

const NAME = 'portal-initiative-conformance-reviewer';
const CANONICAL_ROUTES = ['index', 'discover', 'try', 'build', 'operate', 'inspect', 'roadmap'];
// Non-canonical top-level routes that are nonetheless allowed (a strategy/ lane
// is a documented optional surface; strategy.astro top-level is its index).
const ALLOWED_EXTRA_ROUTES = ['strategy'];
const CANONICAL_UI_NAMES = ['Shell', 'NavBar', 'AudienceSwitcher', 'LaneCard', 'StatusBadge'];

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

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
      if (e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.astro') await walk(fp, acc);
    } else {
      acc.push(fp);
    }
  }
  return acc;
}

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

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  // Research variant: the portal is optional provenance, not the deliverable — skip.
  const _piYml = await fs.readFile(path.join(artifactsRoot, 'blueprint.yml'), 'utf8').catch(() => '');
  if (/^variant:\s*research\b/m.test(_piYml)) {
    return result('PASS', [], 'research — out of scope (portal is optional provenance for research)', startedAt);
  }
  const portalDir = path.join(artifactsRoot, 'apps', 'portal');
  const srcDir = path.join(portalDir, 'src');
  const pagesDir = path.join(srcDir, 'pages');
  const componentsDir = path.join(srcDir, 'components');

  // Tier gate — Tier 0 has no portal contract.
  const tier = blueprintYml && (blueprintYml.tier ?? blueprintYml.Tier);
  if (tier === 0 || tier === '0') {
    return result('PASS', [], 'tier 0 — no Initiative Portal portal contract', startedAt);
  }

  // 1. Locate the portal.
  if (!(await exists(portalDir))) {
    findings.push({
      severity: 'BLOCK',
      location: 'apps/portal/',
      message: 'No apps/portal/ directory — initiative is still Tier 0 or misnamed the portal dir.',
      remediation:
        'Scaffold it: `blueprint init --pattern=A` (or `npx @nino-chavez-labs/blueprint-cli init --pattern=A`). If the portal lives elsewhere, fix portal_type/paths in blueprint.yml.',
      reference: 'docs/portal-and-tier-ladder.md#pattern-a-platform-portal',
    });
    return finalize(findings, 'no apps/portal/', startedAt);
  }
  for (const rel of ['portal', path.join('blueprint', 'portal')]) {
    if (await exists(path.join(artifactsRoot, rel))) {
      findings.push({
        severity: 'BLOCK',
        location: `${rel}/`,
        message: `Two portal patterns present (apps/portal/ + ${rel}/) — pick one per the tier ladder.`,
        remediation: `Remove the unused ${rel}/ (Pattern B) surface, or write an ADR justifying coexistence (rare — only when the initiative genuinely needs both a platform-portal and a redesign-review portal).`,
        reference: 'docs/portal-and-tier-ladder.md',
      });
    }
  }

  // Collect file contents once.
  const portalFiles = await walk(portalDir);
  const codeFiles = portalFiles.filter((f) => /\.(astro|tsx|ts)$/.test(f));
  const codeText = (await Promise.all(codeFiles.map(read))).filter((c) => c != null).join('\n');

  // 2. Canonical routes.
  const missing = [];
  for (const r of CANONICAL_ROUTES) {
    if (!(await exists(path.join(pagesDir, `${r}.astro`)))) missing.push(r);
  }
  if (missing.length) {
    findings.push({
      severity: 'BLOCK',
      location: 'apps/portal/src/pages/',
      message: `Missing canonical IA route(s): ${missing.join(', ')}.`,
      remediation: `Create apps/portal/src/pages/{${missing.join(',')}}.astro. Placeholder content is fine — the contract requires the route file exists; renaming a canonical route requires an ADR.`,
      reference: 'docs/portal-and-tier-ladder.md#pattern-a-the-ia-contract',
    });
  }
  const topRoutes = (await fs.readdir(pagesDir).catch(() => []))
    .filter((f) => f.endsWith('.astro'))
    .map((f) => f.replace(/\.astro$/, ''));
  for (const n of topRoutes) {
    if (!CANONICAL_ROUTES.includes(n) && !ALLOWED_EXTRA_ROUTES.includes(n)) {
      findings.push({
        severity: 'BLOCK',
        location: `apps/portal/src/pages/${n}.astro`,
        message: `Non-canonical top-level route '${n}'.`,
        remediation: `Nest it under a canonical verb (e.g. inspect/${n}.astro) or file an ADR against the IA contract — the seven verb names are canonical.`,
        reference: 'docs/portal-and-tier-ladder.md#pattern-a-the-ia-contract',
      });
    }
  }

  // 3. Audience switcher — present anywhere in the shell/nav, sourced from @blueprint/ui
  //    (the generic harness renders it in PortalNav, not Layout directly).
  if (!(/AudienceSwitcher/.test(codeText) && /@blueprint\/ui/.test(codeText))) {
    findings.push({
      severity: 'BLOCK',
      location: 'apps/portal/src/',
      message: 'Audience switcher missing — no AudienceSwitcher from @blueprint/ui in the portal shell/nav.',
      remediation:
        "Import { AudienceSwitcher, useAudiencePreference } from '@blueprint/ui' in the nav (PortalNav) or Layout and render <AudienceSwitcher /> in the navbar slot. Pill identifiers are configurable; the component presence is required.",
      reference: 'docs/portal-and-tier-ladder.md#pattern-a-the-ia-contract',
    });
  }

  // 4. Canonical shell sourcing + no local shadows.
  const uiCount = (codeText.match(/from ['"]@blueprint\/ui/g) || []).length;
  const tokCount = (codeText.match(/@blueprint\/design-tokens/g) || []).length;
  if (uiCount < 1) {
    findings.push({
      severity: 'BLOCK',
      location: 'apps/portal/src/',
      message: 'No imports from @blueprint/ui — the portal must consume the canonical shell kit.',
      remediation: "Import shell components (NavBar, AudienceSwitcher, LaneCard, StatusBadge, ...) from '@blueprint/ui' rather than re-rolling them locally.",
      reference: 'docs/portal-and-tier-ladder.md',
    });
  }
  if (tokCount < 1) {
    findings.push({
      severity: 'WARN',
      location: 'apps/portal/',
      message: 'No reference to @blueprint/design-tokens.',
      remediation: 'Wire the @blueprint/design-tokens Tailwind preset so tokens come from the canonical kit, not ad-hoc CSS.',
      reference: 'docs/portal-and-tier-ladder.md',
    });
  }
  const compFiles = await fs.readdir(componentsDir).catch(() => []);
  for (const cn of CANONICAL_UI_NAMES) {
    const shadow = compFiles.find((f) => f === `${cn}.tsx` || f === `${cn}.astro`);
    if (!shadow) continue;
    const head = ((await read(path.join(componentsDir, shadow))) || '').split('\n').slice(0, 8).join('\n');
    const justified = /ADR-\d|canonical|divergence/i.test(head);
    findings.push({
      severity: justified ? 'WARN' : 'BLOCK',
      location: `apps/portal/src/components/${shadow}`,
      message: `Local component shadows canonical @blueprint/ui export '${cn}'${justified ? ' (divergence documented)' : ''}.`,
      remediation: `Use ${cn} from '@blueprint/ui'. If a divergence is genuinely needed, document it + cite an ADR in the file's top comment (canonical-pattern-first).`,
      reference: 'canonical-pattern-first',
    });
  }

  // 5. package.json wiring.
  let pkg = {};
  try {
    pkg = JSON.parse((await read(path.join(portalDir, 'package.json'))) || '{}');
  } catch {
    /* falls through to missing-dep findings */
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const dep of ['astro', 'react', 'react-dom', '@blueprint/ui', '@blueprint/design-tokens']) {
    if (!deps[dep]) {
      findings.push({
        severity: 'BLOCK',
        location: 'apps/portal/package.json',
        message: `Missing dependency '${dep}'.`,
        remediation: `Add "${dep}" to apps/portal/package.json dependencies (workspace '*' or a pinned version). A non-Astro/React stack requires an ADR naming the canonical-stack disqualifier.`,
        reference: 'docs/portal-and-tier-ladder.md',
      });
    }
  }

  // 6. Not a deliberation venue.
  const variantRoutes = topRoutes.filter((n) => /-(a|b|c)$/.test(n) || /-variant-/.test(n));
  if (variantRoutes.length) {
    findings.push({
      severity: 'BLOCK',
      location: 'apps/portal/src/pages/',
      message: `Variant routes present (${variantRoutes.join(', ')}) — portal reads as a deliberation venue, not a confident preview.`,
      remediation: 'Move variant-walking to blueprint/prototype/ (Tier 0 design-principles scratch) or to decisions/ ADRs. The portal is the stakeholder deliverable, not a "pick one" surface.',
      reference: 'confident-preview-rule',
    });
  }

  // 7. No REPLACE_FOR_PROJECT banners (portal src + packages/ui/preview).
  const bannerScan = [...portalFiles];
  const previewDir = path.join(artifactsRoot, 'packages', 'ui', 'preview');
  if (await exists(previewDir)) bannerScan.push(...(await walk(previewDir)));
  const bannered = [];
  for (const f of bannerScan.filter((f) => /\.(astro|tsx|ts|js|html)$/.test(f))) {
    const c = await read(f);
    if (c && c.includes('REPLACE_FOR_PROJECT')) bannered.push(path.relative(targetDir, f));
  }
  if (bannered.length) {
    findings.push({
      severity: 'BLOCK',
      location: bannered.slice(0, 5).join(', ') + (bannered.length > 5 ? ` (+${bannered.length - 5} more)` : ''),
      message: `${bannered.length} file(s) still carry a REPLACE_FOR_PROJECT marker — placeholder/example content not yet populated or deleted.`,
      remediation:
        'Before sharing with stakeholders: populate each marked surface from this initiative\'s deliverables, or delete the file if the route is unused (the IA permits a strategy/ with only index.astro; the substrate sub-pages under inspect/ may be deleted when no Hive/state substrate is wired). A shareable portal has zero REPLACE_FOR_PROJECT markers.',
      reference: 'portal-initiative-conformance-reviewer.md#7-no-replace_for_project-banner',
    });
  }

  // 8. Legacy invariants (I-2 page identifier, I-3 providers-in-Layout, I-5 no inline styles).
  // Net-new Tier-1 portals BLOCK on I-3/I-5; migrating initiatives WARN.
  const netNew = !(await exists(path.join(artifactsRoot, 'blueprint', 'prototype')));
  const routeFiles = (await fs.readdir(pagesDir).catch(() => [])).filter((f) => f.endsWith('.astro'));
  const inlineStyleHits = [];
  for (const rf of routeFiles) {
    const c = (await read(path.join(pagesDir, rf))) || '';
    if (/\sstyle=("|'|\{)/.test(c)) inlineStyleHits.push(`pages/${rf}`);
  }
  if (inlineStyleHits.length) {
    findings.push({
      severity: netNew ? 'BLOCK' : 'WARN',
      location: inlineStyleHits.slice(0, 4).join(', '),
      message: `I-5: inline style attributes in route file(s) — styles should come from Tailwind / @blueprint/design-tokens, not inline blocks.`,
      remediation: 'Replace inline style="..." with Tailwind classes (the @blueprint/design-tokens preset) or co-located component CSS.',
      reference: 'portal-initiative-conformance-reviewer.md#8-legacy-invariants',
    });
  }

  const summary = `${CANONICAL_ROUTES.length - missing.length}/${CANONICAL_ROUTES.length} routes, ui=${uiCount} tokens=${tokCount}, banners=${bannered.length}`;
  return finalize(findings, summary, startedAt);
}
