/**
 * roadmap-registry-sync-reviewer.mjs — executable pair for roadmap-registry-sync-reviewer.md.
 * Wave 27: mechanical enforcement of registry-view synchronization. Promoted on the
 * 2026-06-11 evidence from rally-hq: prescription.yml and roadmap.md drifted silently
 * across multiple waves while 12 arcs shipped, advisory rules never caught it, and
 * every instance was operator-caught not gate-caught. Hardcoded status in plan docs
 * drifts from the registry; this lints the drift.
 *
 * ADR-0002 reviewer contract:
 *   export default async function review({ targetDir, blueprintYml, methodologyHome })
 *     -> { status: 'PASS'|'WARN'|'BLOCKED', findings: [...], metadata: {...} }
 *
 * Four checks per declared registry-view pair:
 *   1. registry-presence-in-view — every planned/in-progress item in registry
 *      must appear in view
 *   2. shipped-not-in-build-tier — no item in the "build" section of the view
 *      can have status shipped (shipped work belongs in ledger/archive)
 *   3. view-id-validity — every item-id the view references must exist in
 *      the registry (typo guard)
 *   4. id-uniqueness — item ids must be unique within registry
 *
 * Default pair (when stateful_pairs absent): if both prescription.yml and
 * docs/roadmap.md exist, they form the default pair. Otherwise skipped (INFO).
 *
 * REGISTRY FORMATS:
 *   - YAML (prescription.yml standard): parsed via URL import of yaml pkg
 *   - JSON: parsed via JSON.parse
 *   - Custom: requires item_id_column in the stateful_pairs config
 *
 * VIEW EXTRACTION:
 *   - Markdown tables only (word P-id references extracted via regex)
 *   - Section detection: looks for ## Build / ## Phase sections to define
 *     the "build tier" for shipped-not-in-build check
 *
 * SKIPS when sources absent — if a declared pair cannot be located or parsed,
 * the check is skipped (INFO), so the reviewer is safe in consumer repos.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NAME = 'roadmap-registry-sync-reviewer';
const MAX_FINDINGS = 50;

const read = (p) => fs.readFile(p, 'utf8').then((s) => s, () => null);

/**
 * Extract item ids from text (e.g., P1, P29a, P100 all captured as P1, P29, P100).
 * Word-bounded so "0P0" doesn't match, but "P29a" matches as "P29".
 */
function itemIdsInText(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bP(\d+)[a-z]?\b/gi)) {
    ids.add(`P${m[1]}`);
  }
  return ids;
}

/**
 * Parse YAML via dynamic import (avoids hard npm dependency).
 * Returns parsed object or null if parse fails.
 */
async function parseYaml(content) {
  try {
    const { parse } = await import('yaml');
    return parse(content);
  } catch {
    return null;
  }
}

/**
 * Parse JSON. Returns parsed object or null.
 */
function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Determine if path is a YAML or JSON file.
 */
function fileFormat(filePath) {
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'yaml';
  if (filePath.endsWith('.json')) return 'json';
  return 'unknown';
}

/**
 * Extract all item ids from a registry (YAML or JSON).
 * Registry is expected to have an array of objects with id fields.
 * Returns { ids: Map<id, status>, duplicates: Set<id>, errors: string[] }.
 */
function extractRegistryItems(registryData) {
  const ids = new Map();
  const seen = new Set();
  const duplicates = new Set();
  const errors = [];

  // Try standard shape: { change_items: [...], ...}
  if (registryData && typeof registryData === 'object') {
    const changeItems = registryData.change_items || registryData.items || [];
    if (Array.isArray(changeItems)) {
      for (const item of changeItems) {
        if (item.id) {
          if (seen.has(item.id)) {
            duplicates.add(item.id);
          } else {
            ids.set(item.id, item.status || 'unknown');
            seen.add(item.id);
          }
        }
      }
      return { ids, duplicates, errors };
    }
  }

  errors.push('Registry structure unrecognized (expected change_items or items array)');
  return { ids, duplicates, errors };
}

/**
 * Find a section heading in text (e.g., "## Build" or "## Phase 4").
 * Returns the text from that heading to the next same-level heading, or to EOF.
 */
function extractSection(text, headingPattern) {
  const match = text.match(new RegExp(`^${headingPattern}.*?$`, 'mi'));
  if (!match) return '';
  const start = text.indexOf(match[0]);
  const rest = text.slice(start + match[0].length);
  const nextHeading = rest.match(/\n##\s/);
  return nextHeading
    ? rest.slice(0, nextHeading.index)
    : rest;
}

/**
 * Run the reviewer against a target (a consumer repo or methodology home).
 * Returns { status, findings, metadata }.
 */
export default async function review({ targetDir, blueprintYml, methodologyHome }) {
  const startedAt = Date.now();
  const findings = [];
  const counters = { pairs: 0, items: 0, mismatches: 0, skippedPairs: [] };

  // Load blueprint.yml to read stateful_pairs config
  let pairs = [];
  if (blueprintYml && blueprintYml.stateful_pairs && Array.isArray(blueprintYml.stateful_pairs)) {
    pairs = blueprintYml.stateful_pairs;
  } else {
    // Try to load blueprint.yml from disk
    const ymlPath = path.join(targetDir, 'blueprint.yml');
    const ymlContent = await read(ymlPath);
    if (ymlContent) {
      try {
        const yaml = await parseYaml(ymlContent);
        if (yaml && yaml.stateful_pairs && Array.isArray(yaml.stateful_pairs)) {
          pairs = yaml.stateful_pairs;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Apply default pair if none declared
  if (pairs.length === 0) {
    const defaultRegistry = path.join(targetDir, 'prescription.yml');
    const defaultView = path.join(targetDir, 'docs', 'roadmap.md');
    const regExists = await read(defaultRegistry);
    const viewExists = await read(defaultView);
    if (regExists && viewExists) {
      pairs = [{ registry: 'prescription.yml', view: 'docs/roadmap.md' }];
    } else if (regExists || viewExists) {
      findings.push({
        severity: 'INFO',
        check: 'default-pair-incomplete',
        message: 'Found registry or view but not both — default pair incomplete. Declare stateful_pairs in blueprint.yml if using non-default paths.',
      });
      counters.skippedPairs.push('default (incomplete)');
      counters.pairs = 1; // Count the attempted pair
    } else {
      // No default pair components found; safe to skip
      counters.skippedPairs.push('default (sources absent)');
      counters.pairs = 1; // Count as one attempted pair
    }
  }

  // Process each declared pair
  for (const pair of pairs) {
    const registryPath = path.join(targetDir, pair.registry);
    const viewPath = path.join(targetDir, pair.view);
    counters.pairs++;

    // Read registry
    const registryContent = await read(registryPath);
    if (!registryContent) {
      counters.skippedPairs.push(`${pair.registry} (not found)`);
      continue;
    }

    // Read view
    const viewContent = await read(viewPath);
    if (!viewContent) {
      counters.skippedPairs.push(`${pair.view} (not found)`);
      continue;
    }

    // Parse registry
    const regFormat = fileFormat(pair.registry);
    let registryData = null;
    if (regFormat === 'yaml') {
      registryData = await parseYaml(registryContent);
    } else if (regFormat === 'json') {
      registryData = parseJson(registryContent);
    }

    if (!registryData) {
      counters.skippedPairs.push(`${pair.registry} (parse failed)`);
      continue;
    }

    // Extract items from registry
    const { ids, duplicates, errors: parseErrors } = extractRegistryItems(registryData);
    if (parseErrors.length > 0) {
      findings.push({
        severity: 'WARN',
        check: 'registry-structure',
        file: pair.registry,
        message: `Registry structure warning: ${parseErrors[0]}`,
      });
    }

    counters.items += ids.size;

    const registryIds = new Set(ids.keys());
    const viewIds = itemIdsInText(viewContent);

    // Check 1: registry-presence-in-view
    const activeItems = [...ids.entries()]
      .filter(([, status]) => status === 'planned' || status === 'in-progress')
      .map(([id]) => id);
    const missingFromView = activeItems.filter((id) => !viewIds.has(id));
    if (missingFromView.length > 0) {
      for (const id of missingFromView.slice(0, MAX_FINDINGS - findings.length)) {
        counters.mismatches++;
        findings.push({
          severity: 'BLOCK',
          check: 'registry-presence-in-view',
          file: pair.view,
          message: `Item ${id} is ${ids.get(id)} in registry but absent from view — sequence it or update registry status`,
        });
      }
    }

    // Check 2: shipped-not-in-build-tier
    const buildSection = extractSection(viewContent, '## (Build|Phase)');
    const buildIds = itemIdsInText(buildSection);
    const shippedInBuild = [...buildIds].filter((id) => ids.get(id) === 'shipped');
    if (shippedInBuild.length > 0) {
      for (const id of shippedInBuild.slice(0, MAX_FINDINGS - findings.length)) {
        counters.mismatches++;
        findings.push({
          severity: 'BLOCK',
          check: 'shipped-not-in-build-tier',
          file: pair.view,
          message: `Item ${id} is shipped in registry but still listed in build section — move to ledger/archive`,
        });
      }
    }

    // Check 3: view-id-validity
    const ghostIds = [...viewIds].filter((id) => !registryIds.has(id));
    if (ghostIds.length > 0) {
      for (const id of ghostIds.slice(0, MAX_FINDINGS - findings.length)) {
        counters.mismatches++;
        findings.push({
          severity: 'BLOCK',
          check: 'view-id-validity',
          file: pair.view,
          message: `Item ${id} referenced in view but does not exist in registry — typo or deleted item`,
        });
      }
    }

    // Check 4: id-uniqueness
    if (duplicates.size > 0) {
      for (const id of [...duplicates].slice(0, MAX_FINDINGS - findings.length)) {
        counters.mismatches++;
        findings.push({
          severity: 'BLOCK',
          check: 'id-uniqueness',
          file: pair.registry,
          message: `Item id ${id} appears multiple times in registry — rename or remove duplicates`,
        });
      }
    }
  }

  if (counters.skippedPairs.length > 0 && counters.pairs === counters.skippedPairs.length) {
    findings.push({
      severity: 'INFO',
      check: 'scope',
      message: `All pairs skipped (sources absent or parse errors): ${counters.skippedPairs.join(', ')}. Check blueprint.yml stateful_pairs configuration.`,
    });
  }

  const hasBlock = findings.some((f) => f.severity === 'BLOCK');
  const status = hasBlock ? 'BLOCKED' : 'PASS';
  const summary = `pairs=${counters.pairs}, items=${counters.items}, mismatches=${counters.mismatches}, skipped=[${counters.skippedPairs.join(',')}]`;
  return { status, findings, metadata: { reviewer: NAME, targetSummary: summary, durationMs: Date.now() - startedAt } };
}

// ── Self-test (node roadmap-registry-sync-reviewer.mjs --self-test) ────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--self-test')) {
  const os = await import('node:os');
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  let n = 0;
  const ok = (cond, msg) => { assert(cond, msg); n++; };

  // Test itemIdsInText
  const testText = 'See P1, P29a, and P100. Also P1 again (no duplicates).';
  const extracted = itemIdsInText(testText);
  ok(extracted.has('P1') && extracted.has('P29') && extracted.has('P100'), 'id extraction with variants');
  ok(extracted.size === 3, 'id deduplication');

  // Build a temp test directory with mock registry and view
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rrs-'));
  const w = (rel, s) => fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true }).then(() => fs.writeFile(path.join(tmp, rel), s));

  // Create a registry with 3 items: P1 (shipped), P2 (in-progress), P3 (planned)
  const yamlRegistry = `
change_items:
  - id: P1
    status: shipped
  - id: P2
    status: in-progress
  - id: P3
    status: planned
  - id: P3
    status: planned-dup
open_questions: []
`;

  // Create a roadmap view that:
  // - Includes P2 and P3 (active items)
  // - Missing P2 (should fail rule 1)
  // - References P99 (ghost, should fail rule 3)
  // - Lists P1 in Phase build section (should fail rule 2)
  const mdView = `
# Roadmap

## Phase 1
See P1 here (shipped, but still in build).

## Backlog
P3 and P99 (which doesn't exist).
`;

  await w('prescription.yml', yamlRegistry);
  await w('docs/roadmap.md', mdView);

  let r = await review({ targetDir: tmp, blueprintYml: null, methodologyHome: tmp });
  ok(r.status === 'BLOCKED', `drifted sync → BLOCKED (got ${r.status})`);
  ok(r.findings.some((f) => f.check === 'shipped-not-in-build-tier'), 'shipped-in-build detected');
  ok(r.findings.some((f) => f.check === 'view-id-validity'), 'ghost id detected');
  ok(r.findings.some((f) => f.check === 'id-uniqueness'), 'duplicate id detected');
  ok(r.findings.some((f) => f.check === 'registry-presence-in-view'), 'missing active item detected');

  // Corrected view and registry → PASS
  const mdViewFixed = `
# Roadmap

## Phase 1
P2 and P3 tracked here.
`;
  const yamlRegistryFixed = `
change_items:
  - id: P1
    status: shipped
  - id: P2
    status: in-progress
  - id: P3
    status: planned
open_questions: []
`;
  await w('prescription.yml', yamlRegistryFixed);
  await w('docs/roadmap.md', mdViewFixed);
  r = await review({ targetDir: tmp, blueprintYml: null, methodologyHome: tmp });
  ok(r.status === 'PASS', `corrected sync → PASS (got ${r.status})`);

  // Consumer repo with no stateful pairs → PASS with skip INFO
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'rrs2-'));
  r = await review({ targetDir: tmp2, blueprintYml: null, methodologyHome: tmp2 });
  ok(r.status === 'PASS' && r.findings.some((f) => f.check === 'scope'), 'absent sources → checks skip, PASS + INFO');

  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(tmp2, { recursive: true, force: true });
  console.log(`roadmap-registry-sync-reviewer self-test: PASS (${n} assertions)`);
}
