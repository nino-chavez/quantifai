import type { StateSummary, BoardSummary } from '@/lib/derived';

export interface HeroStatsProps {
  state: StateSummary;
  board: BoardSummary;
  adrCount: number;
  /** Render the capability/state tile — true only when the state source exists. */
  showState?: boolean;
  /** Render the board tile — true only when the board source exists. */
  showBoard?: boolean;
  /** Decisions directory label, from portalConfig().decisions.dir. */
  decisionsDir?: string;
}

/**
 * Stat strip below the homepage hero — live data from the derive tools. Each
 * tile shows a primary number, a label, and a secondary detail line. Tiles are
 * gated on their data source: the ADR tile renders whenever decisions exist on
 * disk (loadAdrCount degrades to 0), the state and board tiles render only when
 * their sources are configured + present. At Tier-0 only the ADR tile shows.
 * No interaction; rendered statically.
 */
export function HeroStats({
  state,
  board,
  adrCount,
  showState = false,
  showBoard = false,
  decisionsDir = 'decisions',
}: HeroStatsProps) {
  const visibleCount = (showState ? 1 : 0) + 1 /* ADR always */ + (showBoard ? 1 : 0);
  const gridCols =
    visibleCount >= 3 ? 'sm:grid-cols-3' : visibleCount === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1';

  return (
    <section
      aria-label="Live portal stats"
      className={`mb-12 grid gap-3 ${gridCols}`}
    >
      {showState && (
        <div className="rounded-lg border border-contrast-200 bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-400">
            BRD + ADR + NFR capabilities
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-heading text-3xl font-semibold leading-none tracking-tight text-foreground">
              {state.compliant + state.partial}
            </span>
            <span className="font-heading text-sm font-medium text-contrast-400">
              / {state.total}
            </span>
          </div>
          <p className="mt-1 text-xs text-contrast-500">
            shipped <span className="font-mono text-[10px] text-success-foreground">
              {state.shippedPercent}%
            </span>
            {state.partial > 0 && (
              <> · {state.partial} partial · {state.manualReview} manual-review</>
            )}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-contrast-200 bg-background p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-400">
          Architecture decisions
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-heading text-3xl font-semibold leading-none tracking-tight text-foreground">
            {adrCount}
          </span>
          <span className="font-heading text-sm font-medium text-contrast-400">
            ADRs ratified
          </span>
        </div>
        <p className="mt-1 text-xs text-contrast-500">
          indexed at <code className="font-mono text-[10px]">{decisionsDir}/</code>
        </p>
      </div>

      {showBoard && (
        <div className="rounded-lg border border-contrast-200 bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-400">
            Work board
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-heading text-3xl font-semibold leading-none tracking-tight text-foreground">
              {board.totalOpen}
            </span>
            <span className="font-heading text-sm font-medium text-contrast-400">
              open · {board.totalClosed} closed
            </span>
          </div>
          <p className="mt-1 text-xs text-contrast-500">
            {board.byBucket.find((b) => b.bucket === 'in-flight')?.count ?? 0} in flight
            {' · '}
            {board.byBucket.find((b) => b.bucket === 'awaiting-dispatch')?.count ?? 0} awaiting dispatch
          </p>
        </div>
      )}
    </section>
  );
}
