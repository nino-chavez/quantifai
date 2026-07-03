import type {
  BoardSummary,
  BoardIssue,
  EpicProgressSummary,
  BuildOrderSummary,
  BuildOrderStep,
} from '@/lib/derived';

export interface RoadmapViewProps {
  /** Build-order plan (Blueprint-native step ladder). Preferred when present. */
  buildOrder: BuildOrderSummary;
  /** Coordination-board horizon. Fallback when build-order is unconfigured. */
  board: BoardSummary;
  /** Epic activity footprints. Rendered alongside the board horizon. */
  epicProgress: EpicProgressSummary;
  /**
   * Phase labels in canonical order, from portalConfig().board.phases. The Nth
   * label maps to the Nth phase band; an empty list falls back to the raw key.
   */
  phaseLabels: string[];
  /**
   * Repo host base URL (portalConfig().repoUrl). When empty (Tier 0 / no repo
   * configured) issue numbers render as plain text instead of broken links.
   */
  repoUrl: string;
}

// ── Issue-link helper ────────────────────────────────────────────────────────

/** Build an issue URL from the configured repo base, or null when unset. */
function issueUrl(repoUrl: string, number: number): string | null {
  if (!repoUrl) return null;
  return `${repoUrl.replace(/\/$/, '')}/issues/${number}`;
}

/**
 * Strip a single leading bracket tag (e.g. "[Spec] ", "[Type] ") from an
 * issue title. Generic — matches any `[...]` prefix rather than a fixed set of
 * project-specific tag words, then collapses leading whitespace.
 */
function stripLeadingTag(title: string): string {
  return title.replace(/^\s*\[[^\]]+\]\s*/, '');
}

// ── Status chips ─────────────────────────────────────────────────────────────

function PhaseChip({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="rounded-full bg-contrast-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-contrast-500">
      {label}
    </span>
  );
}

function PriorityChip({ priority }: { priority?: string }) {
  if (!priority) return null;
  const norm = priority.replace(/^P/i, '').toUpperCase();
  const tone =
    norm === '0'
      ? 'bg-error-background text-error-foreground'
      : norm === '1'
      ? 'bg-warning-background text-warning-foreground'
      : 'bg-contrast-100 text-contrast-500';
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase ${tone}`}>
      P{norm}
    </span>
  );
}

// ── Build-order step ladder (preferred render) ───────────────────────────────

const STEP_STATUS_META: Record<string, { tag: string; tone: string; dot: string }> = {
  done:     { tag: 'Done',     tone: 'text-success-foreground', dot: 'bg-success' },
  shipped:  { tag: 'Shipped',  tone: 'text-success-foreground', dot: 'bg-success' },
  active:   { tag: 'Active',   tone: 'text-brand',              dot: 'bg-brand' },
  inflight: { tag: 'In flight',tone: 'text-brand',              dot: 'bg-brand' },
  blocked:  { tag: 'Blocked',  tone: 'text-error-foreground',   dot: 'bg-error' },
  queued:   { tag: 'Queued',   tone: 'text-contrast-400',       dot: 'bg-contrast-300' },
};

function stepStatusMeta(status?: string) {
  const key = (status ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  return STEP_STATUS_META[key] ?? { tag: status ?? 'Planned', tone: 'text-contrast-400', dot: 'bg-contrast-300' };
}

function StepRow({
  step,
  index,
  trackLabel,
}: {
  step: BuildOrderStep;
  index: number;
  trackLabel?: string;
}) {
  const meta = stepStatusMeta(step.status);
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-contrast-100 py-3 last:border-b-0">
      <span className="flex items-center gap-1.5 font-mono text-xs text-contrast-400">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
        {index + 1}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground" title={step.title}>
          {step.title || step.id || `Step ${index + 1}`}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-contrast-400">
          {trackLabel && (
            <span className="rounded bg-contrast-100 px-1.5 py-0.5 uppercase tracking-wide text-contrast-500">
              {trackLabel}
            </span>
          )}
          {step.phase && (
            <span className="uppercase tracking-wide">phase {step.phase}</span>
          )}
          {step.dependsOn && step.dependsOn.length > 0 && (
            <span title={`depends on ${step.dependsOn.join(', ')}`}>
              ⛓ {step.dependsOn.length} dep{step.dependsOn.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wide ${meta.tone}`}>
        {meta.tag}
      </span>
    </li>
  );
}

function BuildOrderLadder({ buildOrder }: { buildOrder: BuildOrderSummary }) {
  const trackLabel = new Map(buildOrder.tracks.map((t) => [t.id, t.label || t.id]));
  return (
    <section aria-label="Build order">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Build order</h2>
        <span className="font-mono text-xs text-contrast-400">
          {buildOrder.steps.length} step{buildOrder.steps.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mb-3 text-sm text-contrast-500">
        The dependency-ordered step ladder for this initiative. Each step lands in sequence;
        blocked steps wait on their dependencies before dispatch.
      </p>
      <ol className="rounded-lg border border-contrast-200 bg-background px-4">
        {buildOrder.steps.map((step, i) => (
          <StepRow
            key={step.id || i}
            step={step}
            index={i}
            trackLabel={step.track ? trackLabel.get(step.track) ?? step.track : undefined}
          />
        ))}
      </ol>
      {buildOrder.tracks.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-contrast-400">
          {buildOrder.tracks.map((t) => (
            <span key={t.id} className="rounded bg-contrast-100 px-1.5 py-0.5 uppercase tracking-wide">
              {t.label || t.id}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// ── Board horizon (fallback render) ──────────────────────────────────────────

function IssueRow({ issue, repoUrl, phaseLabel }: { issue: BoardIssue; repoUrl: string; phaseLabel?: string }) {
  const cleanTitle = stripLeadingTag(issue.title);
  const href = issueUrl(repoUrl, issue.number);
  return (
    <li className="group flex items-baseline gap-3 border-b border-contrast-100 py-2 last:border-b-0">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-contrast-400 group-hover:text-brand"
        >
          #{issue.number}
        </a>
      ) : (
        <span className="font-mono text-xs text-contrast-400">#{issue.number}</span>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex-1 truncate text-sm text-foreground hover:text-brand hover:underline"
          title={cleanTitle}
        >
          {cleanTitle}
        </a>
      ) : (
        <span className="flex-1 truncate text-sm text-foreground" title={cleanTitle}>
          {cleanTitle}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <PriorityChip priority={issue.priority} />
        <PhaseChip label={phaseLabel} />
        {issue.ageDays > 0 && (
          <span className="font-mono text-[10px] text-contrast-400">{issue.ageDays}d</span>
        )}
      </div>
    </li>
  );
}

function HorizonCard({
  label,
  count,
  hint,
  tone,
}: {
  label: string;
  count: number;
  hint: string;
  tone: 'now' | 'next' | 'later';
}) {
  const toneClasses = {
    now:   'border-success/40 bg-success-background/40 text-success-foreground',
    next:  'border-brand/40 bg-brand-background/40 text-brand-foreground',
    later: 'border-contrast-300 bg-contrast-100/30 text-contrast-500',
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClasses}`}>
      <p className="font-mono text-[10px] uppercase tracking-wide">{label}</p>
      <p className="mt-1 font-heading text-3xl font-semibold leading-none tracking-tight text-foreground">
        {count}
      </p>
      <p className="mt-1 text-xs">{hint}</p>
    </div>
  );
}

function PhaseCard({
  label,
  count,
  status,
}: {
  label: string;
  count: number;
  status: 'shipped' | 'active' | 'queued';
}) {
  const statusMeta = {
    shipped: { tag: 'Shipped', tone: 'text-success-foreground' },
    active:  { tag: 'Active',  tone: 'text-brand' },
    queued:  { tag: 'Queued',  tone: 'text-contrast-400' },
  }[status];
  return (
    <div className="rounded-lg border border-contrast-200 bg-background p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-base font-semibold">{label}</p>
        <span className={`font-mono text-[10px] uppercase tracking-wide ${statusMeta.tone}`}>
          {statusMeta.tag}
        </span>
      </div>
      <p className="mt-3 font-heading text-2xl font-semibold leading-none tracking-tight">
        {count}
      </p>
      <p className="mt-1 text-xs text-contrast-500">
        {count === 0 ? 'no open work' : count === 1 ? 'open proposal' : 'open proposals'}
      </p>
    </div>
  );
}

function EpicRow({ epic, repoUrl }: { epic: EpicProgressSummary['epics'][number]; repoUrl: string }) {
  const link = epic.trackerNumber ? issueUrl(repoUrl, epic.trackerNumber) : null;
  // Progress signal: file-footprint activity relative to a 30-file reference.
  // Imperfect but better than nothing; the bar reads as "scope of activity."
  const activityScore = Math.min(100, Math.round((epic.fileCount / 30) * 100));
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_8rem_6rem] items-center gap-3 border-b border-contrast-100 py-2 last:border-b-0">
      <span className="font-mono text-xs text-contrast-400">Epic {epic.epic}</span>
      <div className="min-w-0">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm text-foreground hover:text-brand hover:underline"
            title={epic.title}
          >
            {epic.title}
          </a>
        ) : (
          <span className="truncate text-sm text-foreground" title={epic.title}>
            {epic.title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-contrast-100">
          <div
            className="h-1.5 rounded-full bg-brand transition-all"
            style={{ width: `${activityScore}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] text-contrast-400">{epic.fileCount}f</span>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 font-mono text-[10px] text-contrast-400">
        <span title={`${epic.prCount} merged PRs`}>{epic.prCount}p</span>
        {epic.inFlightCount > 0 && (
          <span className="rounded bg-success-background px-1.5 py-0.5 text-success-foreground">
            {epic.inFlightCount} ↻
          </span>
        )}
        {epic.openCount > 0 && (
          <span className="rounded bg-contrast-100 px-1.5 py-0.5">{epic.openCount} open</span>
        )}
      </div>
    </li>
  );
}

/**
 * Board-horizon render — the now/next/later view plus phase bands and epic
 * activity. Phase labels come from config (`phaseLabels`), mapping the Nth
 * label to the Nth phase band; missing labels fall back to a generic key.
 */
function BoardHorizon({
  board,
  epicProgress,
  phaseLabels,
  repoUrl,
}: {
  board: BoardSummary;
  epicProgress: EpicProgressSummary;
  phaseLabels: string[];
  repoUrl: string;
}) {
  const now = board.inFlight.length;
  const next = board.readyQueue.length + board.shippedNotClosed.length;
  const later = board.byBucket.find((b) => b.bucket === 'awaiting-synthesis')?.count ?? 0;

  // Phase bands derived from the board's byPhase counts. Labels come from
  // config; band 0 ("foundation") is structurally complete when its open count
  // is zero, the rest are active (first non-empty) → queued.
  const phaseCounts = [
    board.byPhase.foundation,
    board.byPhase.phase1,
    board.byPhase.phase2,
    board.byPhase.phase3,
  ];
  const labelAt = (i: number): string => phaseLabels[i] ?? (i === 0 ? 'Foundation' : `Phase ${i}`);
  const firstActive = phaseCounts.findIndex((c, i) => i > 0 && c > 0);

  return (
    <>
      {/* Horizon */}
      <section aria-label="Horizon">
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">Horizon</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <HorizonCard label="Now" count={now} hint="claimed and in flight" tone="now" />
          <HorizonCard
            label="Next"
            count={next}
            hint={`${board.readyQueue.length} queued · ${board.shippedNotClosed.length} just shipped`}
            tone="next"
          />
          <HorizonCard label="Later" count={later} hint="awaiting synthesis" tone="later" />
        </div>
      </section>

      {/* Phases */}
      <section aria-label="Phases">
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">Phases</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {phaseCounts.map((count, i) => {
            const status: 'shipped' | 'active' | 'queued' =
              i === 0 ? (count === 0 ? 'shipped' : 'active') : i === firstActive ? 'active' : 'queued';
            return <PhaseCard key={i} label={labelAt(i)} count={count} status={status} />;
          })}
        </div>
        {board.byPhase.unknown > 0 && (
          <p className="mt-2 text-xs text-contrast-400">
            {board.byPhase.unknown} open proposal{board.byPhase.unknown === 1 ? '' : 's'} missing a
            phase tag.
          </p>
        )}
      </section>

      {/* Epics — show top 10 by activity */}
      {epicProgress.epics.length > 0 && (
        <section aria-label="Epics">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              Epics (10 most active)
            </h2>
            <span className="font-mono text-xs text-contrast-400">
              {epicProgress.epics.length} total
            </span>
          </div>
          <ul className="rounded-lg border border-contrast-200 bg-background px-4">
            {[...epicProgress.epics]
              .sort((a, b) => b.fileCount - a.fileCount)
              .slice(0, 10)
              .map((epic) => (
                <EpicRow key={epic.epic} epic={epic} repoUrl={repoUrl} />
              ))}
          </ul>
          <p className="mt-2 font-mono text-[10px] text-contrast-400">
            Bar = file-footprint activity (relative). p = merged PRs. ↻ = in flight.
          </p>
        </section>
      )}

      {/* Ready queue */}
      {board.readyQueue.length > 0 && (
        <section aria-label="Ready queue">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">Ready queue</h2>
          <p className="mb-3 text-sm text-contrast-500">
            Unblocked, high-priority proposals queued for dispatch. Operator sets priority; the
            queue auto-orders the rest.
          </p>
          <ul className="rounded-lg border border-contrast-200 bg-background px-4">
            {board.readyQueue.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                repoUrl={repoUrl}
                phaseLabel={issue.phase === 'foundation' ? labelAt(0) : issue.phase ? labelAt(Number(issue.phase)) : undefined}
              />
            ))}
          </ul>
        </section>
      )}

      {/* In flight */}
      <section aria-label="In flight">
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">
          In flight ({board.inFlight.length})
        </h2>
        <p className="mb-3 text-sm text-contrast-500">
          Currently claimed by a session and being implemented.
        </p>
        {board.inFlight.length === 0 ? (
          <div className="rounded-lg border border-contrast-200 bg-background px-4 py-6 text-sm text-contrast-400">
            Nothing in flight. The bench is open.
          </div>
        ) : (
          <ul className="rounded-lg border border-contrast-200 bg-background px-4">
            {board.inFlight.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                repoUrl={repoUrl}
                phaseLabel={issue.phase === 'foundation' ? labelAt(0) : issue.phase ? labelAt(Number(issue.phase)) : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Shipped, not closed */}
      {board.shippedNotClosed.length > 0 && (
        <section aria-label="Shipped not closed">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">
            Shipped, awaiting release ({board.shippedNotClosed.length})
          </h2>
          <p className="mb-3 text-sm text-contrast-500">
            Work merged but the tracking issue is still open — typically waiting on a release
            cut.
          </p>
          <ul className="rounded-lg border border-contrast-200 bg-background px-4">
            {board.shippedNotClosed.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                repoUrl={repoUrl}
                phaseLabel={issue.phase === 'foundation' ? labelAt(0) : issue.phase ? labelAt(Number(issue.phase)) : undefined}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Roadmap render. Prefers the Blueprint-native build-order step ladder when a
 * build-order source is configured; otherwise falls back to the coordination
 * board horizon. The parent gates this behind features.roadmap (board ||
 * buildOrder), so at least one of the two has data when this renders.
 */
export function RoadmapView({ buildOrder, board, epicProgress, phaseLabels, repoUrl }: RoadmapViewProps) {
  const hasBuildOrder = buildOrder.steps.length > 0;
  const hasBoard =
    board.inFlight.length > 0 ||
    board.readyQueue.length > 0 ||
    board.shippedNotClosed.length > 0 ||
    board.byBucket.length > 0 ||
    epicProgress.epics.length > 0;

  return (
    <div className="space-y-12">
      {hasBuildOrder && <BuildOrderLadder buildOrder={buildOrder} />}
      {hasBoard && (
        <BoardHorizon
          board={board}
          epicProgress={epicProgress}
          phaseLabels={phaseLabels}
          repoUrl={repoUrl}
        />
      )}
    </div>
  );
}
