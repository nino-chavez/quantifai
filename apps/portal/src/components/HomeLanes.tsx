import {
  LaneCard,
  StatusBadge,
  useAudiencePreference,
  LANE_VERBS,
  STATUS_VALUES,
  type Audience,
  type Status,
  type LaneVerb,
} from '@blueprint/ui';

export interface Lane {
  verb: LaneVerb;
  description: string;
  status: Status;
}

// Generic, project-agnostic defaults for each canonical lane. A consumer
// overrides description + status per lane via blueprint.yml's portal.home.lanes;
// a fresh Tier-0 stamp renders these as-is. Status reflects lane *maturity*
// (`ready` = works end-to-end, `partial` = useful with gaps, `planned` =
// scaffold only) — an authorial judgment, not a derived count.
const LANE_DEFAULTS: Record<LaneVerb, Lane> = {
  discover: {
    verb: 'discover',
    description:
      'Strategy, value prop, the bet — what this initiative is building and why. Excerpts from canonical source docs.',
    status: 'ready',
  },
  try: {
    verb: 'try',
    description:
      'See it work, live. Prototypes and demos surfaced as embedded views — each a real deployment.',
    status: 'planned',
  },
  build: {
    verb: 'build',
    description:
      'Integrate it. API spec, ADR index, SDKs, component library and design tokens. Each card links to source.',
    status: 'ready',
  },
  operate: {
    verb: 'operate',
    description:
      'Run it day-to-day. Operator and end-user playbooks for living with the system once it ships.',
    status: 'planned',
  },
  inspect: {
    verb: 'inspect',
    description:
      'Under the hood. Methodology, ADR record, and the gate / attestation / dependency dashboards.',
    status: 'ready',
  },
  roadmap: {
    verb: 'roadmap',
    description:
      'Where it is going. Horizon (now / next / later), phase progress, the ready queue, and what is in flight.',
    status: 'ready',
  },
};

const isLaneVerb = (v: unknown): v is LaneVerb =>
  typeof v === 'string' && (LANE_VERBS as readonly string[]).includes(v);
const isStatus = (v: unknown): v is Status =>
  typeof v === 'string' && (STATUS_VALUES as readonly string[]).includes(v);

/**
 * Resolve `portal.home.lanes` (typed `any[]` in the config contract) into the
 * canonical six lanes. Each config entry — `{ verb, description?, status? }` —
 * overrides the default for its verb; unrecognized verbs are ignored; missing
 * fields inherit the generic default. With no configured lanes (Tier-0) the
 * full default set is returned, so the homepage always renders the six-lane map.
 * Pure + serializable so the result can cross the Astro island boundary.
 */
export function normalizeLanes(configLanes: unknown): Lane[] {
  const overrides = new Map<LaneVerb, Partial<Lane>>();
  if (Array.isArray(configLanes)) {
    for (const raw of configLanes) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      if (!isLaneVerb(entry.verb)) continue;
      const patch: Partial<Lane> = {};
      if (typeof entry.description === 'string') patch.description = entry.description;
      if (isStatus(entry.status)) patch.status = entry.status;
      overrides.set(entry.verb, patch);
    }
  }
  return LANE_VERBS.map((verb) => ({
    ...LANE_DEFAULTS[verb],
    ...overrides.get(verb),
  }));
}

// Per-audience lane order. Same lanes; the lead changes by who is looking.
//   executive   — bet first → trajectory → proof → methodology → integration → day-to-day
//   evaluator   — proof first → integration → bet → trajectory → day-to-day → methodology
//   engineering — methodology first → trajectory → bet → integration → proof → day-to-day
const DEFAULT_ORDER: LaneVerb[] = ['discover', 'try', 'build', 'operate', 'inspect', 'roadmap'];
const AUDIENCE_ORDER: Partial<Record<Audience, LaneVerb[]>> = {
  executive:   ['discover', 'roadmap', 'try', 'inspect', 'build', 'operate'],
  evaluator:   ['try', 'build', 'discover', 'roadmap', 'operate', 'inspect'],
  engineering: ['inspect', 'roadmap', 'discover', 'build', 'try', 'operate'],
};

export interface HomeLanesProps {
  lanes: Lane[];
}

/**
 * Lane-card grid on the homepage. Lane order shifts per the persisted audience
 * preference — toggling the switcher in PortalNav re-renders this island via the
 * `blueprint-audience-change` CustomEvent the hook dispatches. Falls back to
 * DEFAULT_ORDER for any unrecognized audience (e.g. during SSR before the
 * preference hydrates) so the static build never throws.
 */
export function HomeLanes({ lanes }: HomeLanesProps) {
  const [audience] = useAudiencePreference();
  const byVerb = new Map(lanes.map((lane) => [lane.verb, lane]));
  const order = AUDIENCE_ORDER[audience] ?? DEFAULT_ORDER;
  const ordered = order
    .map((verb) => byVerb.get(verb))
    .filter((lane): lane is Lane => lane !== undefined);

  return (
    <section aria-label="Portal lanes" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ordered.map((lane) => (
        <LaneCard
          key={lane.verb}
          verb={lane.verb}
          description={lane.description}
          meta={<StatusBadge status={lane.status} />}
        />
      ))}
    </section>
  );
}
