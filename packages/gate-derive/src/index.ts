/**
 * @blueprint/gate-derive — generic gate-derivation substrate for the
 * Blueprint Pattern A portal.
 *
 * This package is the substrate layer behind apps/portal/src/lib/status.ts.
 * It models the 10-gate Epic Definition-of-Done compliance grid and the
 * cross-cutting capability families that a fully-wired consumer can derive
 * from a `_state.json` file (the output of a consumer-side state-derive tool).
 *
 * IMPORTANT — substrate-degrading by design:
 *   At Tier 0 a freshly-stamped portal has ZERO data sources configured.
 *   With no state file present, every function here returns an EMPTY
 *   structure (EPICS = [], readStateDerive(...) returns an empty derive,
 *   deriveGatesForEpic / deriveCrossCuttingGroups return empty grids/groups).
 *   Nothing in this package throws on missing data, so the portal builds
 *   green with no project data. The 10-gate count and the gate labels are
 *   parameters with empty/generic defaults — never marketplace-specific
 *   constants. A consumer that wires up a real state-derive tool supplies
 *   its own EPICS list + gate labels + per-gate mechanical results; this
 *   package keeps the portal-facing contract stable in the meantime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Gate model (generic; consumer overrides via state-derive) ────────────────

/** Number of gates in the Epic DoD grid. Generic default; not a constant. */
export const GATE_COUNT = 10 as const;

export type GateIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Gate labels indexed 1..GATE_COUNT. Empty/generic default — a consumer's
 * state-derive supplies the real labels. status.ts never hardcodes these;
 * pages read whatever the consumer configured (or render placeholders).
 */
export const GATE_LABELS: Record<GateIndex, string> = {
  1: '',
  2: '',
  3: '',
  4: '',
  5: '',
  6: '',
  7: '',
  8: '',
  9: '',
  10: '',
};

// ── Color + attestation types (exact shapes status.ts re-exports) ────────────

/** Computed cell color from the two-stage gate model. */
export type GateColor = 'green' | 'yellow' | 'red' | 'gray';

/** Whether a recorded attestation still verifies against current files. */
export type AttestationFreshness = 'fresh' | 'stale' | 'unverified' | 'none';

/**
 * Operator attestation record for a gate cell (stage 2 of the two-stage
 * model). Generic, source-agnostic — a consumer's state-derive populates
 * these from its own attestation store.
 */
export interface AttestationRecord {
  /** Who signed off. */
  attested_by: string;
  /** When (ISO date). */
  attested_at: string;
  /** Commit the attestation was bound to. */
  commit: string;
  /** Optional free-text note. */
  note?: string;
}

/**
 * A cross-cutting capability family — derived state that does not map to a
 * single per-epic gate (platform conventions, ratified decisions, NFRs,
 * scenario coverage, CI hygiene, etc). Generic container; empty by default.
 */
export interface CrossCuttingGroup {
  /** Stable id for the group. */
  id: string;
  /** Human label. */
  label: string;
  /** Capabilities rolled up under this family. */
  total: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  manualReview: number;
}

// ── State-derive types ───────────────────────────────────────────────────────

/** Per-cell derivation result for a single gate. */
export interface GateCell {
  color: GateColor;
  mechanical_passing: boolean;
  mechanical_note: string;
  attested?: AttestationRecord;
  attestation_freshness: AttestationFreshness;
  needs_reattestation: boolean;
}

/** Operator override metadata attached to an epic's audit doc. */
export interface EpicOverride {
  audit_date?: string;
  oos_marker?: string[];
}

/** Full derivation for one epic: the 10-gate grid + override + doc path. */
export interface EpicGateDerivation {
  gates: Record<GateIndex, GateCell>;
  override?: EpicOverride;
  audit_doc_path?: string;
}

/** One epic entry in the EPICS list. */
export interface EpicDescriptor {
  epic: number;
  title: string;
  phase: string;
  risk_tier: string;
}

/** A single capability row from a consumer's state-derive output. */
export interface StateCapability {
  id: string;
  category: string;
  description: string;
  status: string;
  reference?: string;
}

/** The shape returned by readStateDerive — empty at Tier 0. */
export interface StateDerive {
  capabilities: StateCapability[];
  generated_at: string;
  as_of_commit: string;
}

// ── The generic epics list — EMPTY by default ────────────────────────────────

/**
 * The epics whose gate grids the portal renders. EMPTY by default — a Tier-0
 * portal has no epics, so status.ts iterates nothing and produces an empty
 * GateStatusSummary. A consumer with a real BRD/epic model supplies its own
 * list (via a generated module or by replacing this package). This is NOT any
 * reference project's epic set.
 */
export const EPICS: EpicDescriptor[] = [];

// ── Derivation entry points (degrade-to-empty) ───────────────────────────────

/** Build an empty 10-gate grid (all cells gray / mechanically unknown). */
function emptyGateGrid(): Record<GateIndex, GateCell> {
  const grid = {} as Record<GateIndex, GateCell>;
  for (let g = 1 as number; g <= GATE_COUNT; g++) {
    grid[g as GateIndex] = {
      color: 'gray',
      mechanical_passing: false,
      mechanical_note: '',
      attested: undefined,
      attestation_freshness: 'none',
      needs_reattestation: false,
    };
  }
  return grid;
}

/**
 * Read a consumer's state-derive JSON from <root>/<relPath>. Returns an empty
 * derive when the file is absent or unreadable — NEVER throws. The default
 * relative path is the canonical state-derive location; a consumer wiring a
 * different path passes it explicitly.
 */
export function readStateDerive(
  root: string,
  relPath = 'docs/audits/derived/_state.json',
): StateDerive {
  const empty: StateDerive = { capabilities: [], generated_at: '', as_of_commit: '' };
  try {
    const path = resolve(root, relPath);
    if (!existsSync(path)) return empty;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StateDerive>;
    return {
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
      generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
      as_of_commit: typeof raw.as_of_commit === 'string' ? raw.as_of_commit : '',
    };
  } catch {
    return empty;
  }
}

/**
 * Derive the 10-gate grid for one epic from the supplied (possibly empty)
 * state derive. With no matching state data the grid is all-gray and the
 * epic is treated as unaudited — no throw. A consumer's real state-derive
 * tool replaces this with mechanical-check + attestation logic.
 *
 * Signature matches status.ts's call site: deriveGatesForEpic(epic, state, root).
 */
export function deriveGatesForEpic(
  _epic: EpicDescriptor,
  _state: StateDerive,
  _root: string,
): EpicGateDerivation {
  return {
    gates: emptyGateGrid(),
    override: undefined,
    audit_doc_path: '',
  };
}

/**
 * Derive cross-cutting capability families from the (possibly empty) state
 * derive. Returns [] when there are no capabilities — no throw.
 */
export function deriveCrossCuttingGroups(_state: StateDerive): CrossCuttingGroup[] {
  return [];
}
