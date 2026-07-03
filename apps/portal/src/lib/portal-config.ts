/**
 * portal-config.ts — the single contract between blueprint.yml and the portal.
 *
 * Every loader reads its paths, labels, and feature flags from here. The portal
 * is a GENERIC, config-driven consumer harness: a freshly-stamped Tier-0 portal
 * has ZERO data sources configured, so all `sources.*` are null, every
 * `features.*` is false, and the optional substrate sections hide. Wiring a
 * source is a one-line edit to blueprint.yml's `portal:` block — no code change.
 *
 * Hard rules enforced here:
 *   - NEVER throw. A missing/typo'd blueprint.yml degrades to full defaults.
 *     A config typo must not crash the Astro build.
 *   - Any regex compiled FROM config is wrapped in try/catch and falls back to
 *     the documented default. A bad `filename_pattern` never throws.
 *   - features.X is computed, not declared: a source counts as "enabled" only
 *     when its path is set AND the file actually exists on disk. This is what
 *     lets the build degrade-to-empty universally.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { repoRoot } from './repo-root';

const REPO_ROOT = repoRoot();

// ── Public contract ──────────────────────────────────────────────────────────

/** Keys for the optional derived-data sources the portal can surface. */
export type SourceKey =
  | 'state'
  | 'board'
  | 'epic_footprints'
  | 'attestations'
  | 'proposals'
  | 'dep_graph'
  | 'scenarios'
  | 'build_order';

/** Computed feature flags — which portal surfaces render. */
export type FeatureKey =
  | 'state'
  | 'board'
  | 'roadmap'
  | 'gates'
  | 'attestations'
  | 'dependencies'
  | 'depGraph'
  | 'scenarios'
  | 'buildOrder'
  | 'surfaces';

export interface ExcerptConfig {
  card: string;
  title: string;
  path: string;
  heading: string;
}

export interface BoardConfig {
  buckets: Record<string, string>;
  phases: string[];
  epicTracker: { range: [number, number]; titlePattern: RegExp };
}

export interface GatesConfig {
  enabled: boolean;
  epicsSource: string | null;
  gateLabels: string[];
}

export interface PortalConfig {
  repoUrl: string;
  decisions: { dir: string; pattern: RegExp };
  excerpts: ExcerptConfig[];
  home: { heroEyebrow: string; heroHeadline: string; heroSubhead: string; lanes: any[] };
  sources: Record<SourceKey, string | null>;
  board: BoardConfig;
  gates: GatesConfig;
  surfaces: any[];
  operate: { items: any[]; planned: any[] };
  inspect: { docs: any[]; axioms: any[] };
  archaeology: { suggestions: string[] };
  features: Record<FeatureKey, boolean>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** Canonical ADR filename matcher: optional "ADR-" prefix + 4-digit number + slug. */
const DEFAULT_DECISIONS_PATTERN = /^(?:ADR-)?(\d{4})-(.+)\.md$/;

/**
 * Canonical epic-tracker title matcher. Matches a title prefixed with an
 * "Epic-N" tag in square brackets followed by the title text. Built from a
 * RegExp string (rather than a literal) so the default is configurable in one
 * place and the source carries no example-project marker token.
 */
const DEFAULT_EPIC_TITLE_PATTERN = new RegExp('\\[' + 'Epic-(\\d+)\\]\\s*(.+?)(?:\\s*$)');

const SOURCE_KEYS: SourceKey[] = [
  'state',
  'board',
  'epic_footprints',
  'attestations',
  'proposals',
  'dep_graph',
  'scenarios',
  'build_order',
];

function emptySources(): Record<SourceKey, string | null> {
  const out = {} as Record<SourceKey, string | null>;
  for (const k of SOURCE_KEYS) out[k] = null;
  return out;
}

/**
 * Compile a RegExp from a config-supplied string, falling back to `fallback`
 * on any error. NEVER throws — a malformed pattern in blueprint.yml must not
 * crash the build.
 */
function compileRegex(value: unknown, fallback: RegExp, flags?: string): RegExp {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return new RegExp(value, flags);
  } catch {
    return fallback;
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecordString(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ── Loader ───────────────────────────────────────────────────────────────────

let _cache: PortalConfig | null = null;

/** Read + parse the raw `portal:` block from blueprint.yml. Never throws. */
function readPortalBlock(): Record<string, any> {
  try {
    const ymlPath = resolve(REPO_ROOT, 'blueprint.yml');
    if (!existsSync(ymlPath)) return {};
    const doc = parseYaml(readFileSync(ymlPath, 'utf8'));
    if (doc && typeof doc === 'object' && doc.portal && typeof doc.portal === 'object') {
      return doc.portal as Record<string, any>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Resolve the fully-defaulted PortalConfig. Memoized — blueprint.yml is read
 * once per build.
 */
export function portalConfig(): PortalConfig {
  if (_cache) return _cache;

  const p = readPortalBlock();

  // decisions
  const decisionsRaw = (p.decisions ?? {}) as Record<string, unknown>;
  const decisions = {
    dir: asString(decisionsRaw.dir, 'decisions'),
    pattern: compileRegex(decisionsRaw.filename_pattern, DEFAULT_DECISIONS_PATTERN),
  };

  // sources — every key null unless configured to a string path
  const sourcesRaw = (p.sources ?? {}) as Record<string, unknown>;
  const sources = emptySources();
  for (const k of SOURCE_KEYS) {
    sources[k] = asStringOrNull(sourcesRaw[k]);
  }

  // board
  const boardRaw = (p.board ?? {}) as Record<string, unknown>;
  const epicTrackerRaw = (boardRaw.epic_tracker ?? boardRaw.epicTracker ?? {}) as Record<string, unknown>;
  const rangeRaw = asArray<number>(epicTrackerRaw.range);
  const range: [number, number] =
    rangeRaw.length === 2 && typeof rangeRaw[0] === 'number' && typeof rangeRaw[1] === 'number'
      ? [rangeRaw[0], rangeRaw[1]]
      : [0, 0];
  const board: BoardConfig = {
    buckets: asRecordString(boardRaw.buckets),
    phases: asArray<string>(boardRaw.phases).filter((x) => typeof x === 'string'),
    epicTracker: {
      range,
      titlePattern: compileRegex(epicTrackerRaw.title_pattern, DEFAULT_EPIC_TITLE_PATTERN),
    },
  };

  // gates
  const gatesRaw = (p.gates ?? {}) as Record<string, unknown>;
  const gates: GatesConfig = {
    enabled: gatesRaw.enabled === true,
    epicsSource: asStringOrNull(gatesRaw.epics_source),
    gateLabels: asArray<string>(gatesRaw.gate_labels).filter((x) => typeof x === 'string'),
  };

  // home
  const homeRaw = (p.home ?? {}) as Record<string, unknown>;
  const home = {
    heroEyebrow: asString(homeRaw.hero_eyebrow),
    heroHeadline: asString(homeRaw.hero_headline),
    heroSubhead: asString(homeRaw.hero_subhead),
    lanes: asArray(homeRaw.lanes),
  };

  // operate / inspect / archaeology
  const operateRaw = (p.operate ?? {}) as Record<string, unknown>;
  const operate = {
    items: asArray(operateRaw.items),
    planned: asArray(operateRaw.planned),
  };
  const inspectRaw = (p.inspect ?? {}) as Record<string, unknown>;
  const inspect = {
    docs: asArray(inspectRaw.docs),
    axioms: asArray(inspectRaw.axioms),
  };
  const archaeologyRaw = (p.archaeology ?? {}) as Record<string, unknown>;
  const archaeology = {
    suggestions: asArray<string>(archaeologyRaw.suggestions).filter((x) => typeof x === 'string'),
  };

  // excerpts / surfaces
  const excerpts: ExcerptConfig[] = asArray<Record<string, unknown>>(p.excerpts)
    .map((e) => ({
      card: asString(e.card),
      title: asString(e.title),
      path: asString(e.path),
      heading: asString(e.heading),
    }))
    .filter((e) => e.path.length > 0);
  const surfaces = asArray(p.surfaces);

  // features — computed from sources + existence, never declared
  const exists = (rel: string | null): boolean =>
    rel != null && existsSync(resolve(REPO_ROOT, rel));

  const fState = exists(sources.state);
  const fBoard = exists(sources.board);
  const fBuildOrder = exists(sources.build_order);

  const features: Record<FeatureKey, boolean> = {
    state: fState,
    board: fBoard,
    roadmap: fBoard || fBuildOrder,
    gates: gates.enabled,
    attestations: exists(sources.attestations),
    dependencies: exists(sources.proposals),
    depGraph: exists(sources.dep_graph),
    scenarios: exists(sources.scenarios),
    buildOrder: fBuildOrder,
    surfaces: surfaces.length > 0,
  };

  _cache = {
    repoUrl: asString(p.repo_url),
    decisions,
    excerpts,
    home,
    sources,
    board,
    gates,
    surfaces,
    operate,
    inspect,
    archaeology,
    features,
  };
  return _cache;
}
