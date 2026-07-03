/**
 * Demo scenarios — JSON-driven storyboard previously served at
 * . Source: apps/demos/scenarios.json. Read natively
 * so /try renders scenarios in portal chrome rather than linking out.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './repo-root';
import { portalConfig } from './portal-config';

const REPO_ROOT = repoRoot();

export type ScenarioStatus = 'ready' | 'partial' | 'missing' | 'planned' | 'not-applicable';

export interface SurfaceState {
  surfaceId: string;
  status: ScenarioStatus;
  demoUrl?: string;
  demoScript: string[];
  guide?: string;
}

export interface Scenario {
  id: string;
  category: string;
  title: string;
  summary: string;
  brdRefs: string[];
  prerequisites: string[];
  expectedOutcome: string;
  surfaces: SurfaceState[];
}

export interface ScenariosSummary {
  description: string;
  surfaces: Array<{ id: string; label: string }>;
  scenarios: Scenario[];
  byCategory: Record<string, Scenario[]>;
}

interface RawSurfaceState {
  status: ScenarioStatus;
  demo_url?: string;
  demo_script?: string[];
  guide?: string;
}

interface RawScenario {
  id: string;
  category: string;
  title: string;
  summary: string;
  brd_refs?: string[];
  prerequisites?: string[];
  expected_outcome?: string;
  surfaces?: Record<string, RawSurfaceState>;
}

interface RawSurfaces {
  id: string;
  label: string;
}

interface RawScenariosFile {
  description: string;
  surfaces: RawSurfaces[];
  scenarios: RawScenario[];
}

const EMPTY_SCENARIOS_SUMMARY: ScenariosSummary = {
  description: '',
  surfaces: [],
  scenarios: [],
  byCategory: {},
};

let _cache: ScenariosSummary | null = null;

/**
 * Read demo scenarios from sources.scenarios. Returns the typed empty summary
 * when the source is unconfigured (Tier 0) or missing/unreadable — never throws.
 */
export function loadScenarios(): ScenariosSummary {
  if (_cache) return _cache;
  const rel = portalConfig().sources.scenarios;
  if (!rel) {
    _cache = EMPTY_SCENARIOS_SUMMARY;
    return _cache;
  }
  let raw: RawScenariosFile;
  try {
    const path = resolve(REPO_ROOT, rel);
    if (!existsSync(path)) {
      _cache = EMPTY_SCENARIOS_SUMMARY;
      return _cache;
    }
    raw = JSON.parse(readFileSync(path, 'utf8')) as RawScenariosFile;
  } catch {
    _cache = EMPTY_SCENARIOS_SUMMARY;
    return _cache;
  }
  if (!Array.isArray(raw.scenarios)) {
    _cache = EMPTY_SCENARIOS_SUMMARY;
    return _cache;
  }

  const scenarios: Scenario[] = raw.scenarios.map((s) => ({
    id: s.id,
    category: s.category,
    title: s.title,
    summary: s.summary,
    brdRefs: s.brd_refs ?? [],
    prerequisites: s.prerequisites ?? [],
    expectedOutcome: s.expected_outcome ?? '',
    surfaces: Object.entries(s.surfaces ?? {}).map(([surfaceId, st]) => ({
      surfaceId,
      status: st.status,
      demoUrl: st.demo_url,
      demoScript: st.demo_script ?? [],
      guide: st.guide,
    })),
  }));

  const byCategory: Record<string, Scenario[]> = {};
  for (const s of scenarios) {
    byCategory[s.category] = byCategory[s.category] ?? [];
    byCategory[s.category]!.push(s);
  }

  _cache = {
    description: raw.description ?? '',
    surfaces: Array.isArray(raw.surfaces) ? raw.surfaces.map((s) => ({ id: s.id, label: s.label })) : [],
    scenarios,
    byCategory,
  };
  return _cache;
}
