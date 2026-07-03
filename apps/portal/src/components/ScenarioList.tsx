import type { Scenario, ScenarioStatus, ScenariosSummary } from '@/lib/scenarios';

const STATUS_LABEL: Record<ScenarioStatus, { text: string; tone: string }> = {
  ready:            { text: 'Ready',   tone: 'bg-success-background text-success-foreground' },
  partial:          { text: 'Partial', tone: 'bg-warning-background text-warning-foreground' },
  missing:          { text: 'Missing', tone: 'bg-contrast-100 text-contrast-500' },
  planned:          { text: 'Planned', tone: 'bg-info-background text-info-foreground' },
  'not-applicable': { text: 'N/A',     tone: 'bg-contrast-100/50 text-contrast-400' },
};

const CATEGORY_LABEL: Record<string, string> = {
  'shopper-flow':   'Shopper flows',
  'merchant-setup': 'Merchant setup',
  'merchant-ops':   'Merchant ops',
  'support-ops':    'Support ops',
};

const REPO = 'https://github.com/your-org/quantifai-next/blob/main/apps/demos/scenarios.json';

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  return (
    <article className="rounded-lg border border-contrast-200 bg-background p-5">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-400" title={scenario.id}>
          {scenario.id}
        </p>
        {scenario.brdRefs.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-contrast-500">
            {scenario.brdRefs.join(' · ')}
          </span>
        )}
      </header>
      <h4 className="mb-2 font-heading text-base font-semibold tracking-tight">{scenario.title}</h4>
      <p className="mb-3 text-sm leading-relaxed text-contrast-500">{scenario.summary}</p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {scenario.surfaces.map((s) => {
          const meta = STATUS_LABEL[s.status];
          return (
            <span
              key={s.surfaceId}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${meta.tone}`}
              title={s.guide || meta.text}
            >
              {s.surfaceId} · {meta.text.toLowerCase()}
            </span>
          );
        })}
      </div>

      {scenario.expectedOutcome && (
        <p className="text-xs leading-relaxed text-contrast-500">
          <span className="font-medium text-contrast-400">Expected:</span> {scenario.expectedOutcome}
        </p>
      )}

      {scenario.surfaces.some((s) => s.demoUrl) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {scenario.surfaces
            .filter((s) => s.demoUrl)
            .map((s) => (
              <a
                key={s.surfaceId}
                href={s.demoUrl!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded border border-contrast-300 px-2.5 py-1 font-mono text-[11px] text-foreground hover:border-brand hover:text-brand"
              >
                open {s.surfaceId} ↗
              </a>
            ))}
        </div>
      )}
    </article>
  );
}

export function ScenarioList({ data }: { data: ScenariosSummary }) {
  const categoryOrder = ['shopper-flow', 'merchant-setup', 'merchant-ops', 'support-ops'];

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {categoryOrder.map((cat) => {
          const items = data.byCategory[cat] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="rounded-lg border border-contrast-200 bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-400">
                {CATEGORY_LABEL[cat] ?? cat}
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold leading-none">{items.length}</p>
              <p className="mt-1 text-xs text-contrast-500">scenarios</p>
            </div>
          );
        })}
      </div>

      {categoryOrder.map((cat) => {
        const items = data.byCategory[cat];
        if (!items || items.length === 0) return null;
        return (
          <section key={cat} aria-label={CATEGORY_LABEL[cat] ?? cat}>
            <h3 className="mb-4 font-heading text-lg font-semibold tracking-tight">
              {CATEGORY_LABEL[cat] ?? cat}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((s) => (
                <ScenarioCard key={s.id} scenario={s} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="font-mono text-[10px] text-contrast-400">
        Source: <a href={REPO} target="_blank" rel="noreferrer" className="text-brand hover:underline">apps/demos/scenarios.json</a>. Edit there + rebuild to update.
      </p>
    </div>
  );
}
