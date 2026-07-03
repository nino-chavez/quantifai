import type { StateSummary, NonCompliantCapability } from '@/lib/derived';
import { prettifyCategory } from '@/lib/derived';

export interface CoverageViewProps {
  state: StateSummary;
}

function NonCompliantCard({ item }: { item: NonCompliantCapability }) {
  return (
    <article className="rounded-lg border border-error/30 bg-error-background/30 p-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="rounded bg-error-background px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-error-foreground">
          Non-compliant
        </span>
        <span className="font-mono text-[10px] text-contrast-500">
          {prettifyCategory(item.category)}
        </span>
      </div>
      <p className="mb-1 font-mono text-xs text-contrast-500" title={item.id}>
        {item.id}
      </p>
      <p className="mb-2 text-sm leading-relaxed text-foreground">{item.description}</p>
      {item.reference && (
        <p className="font-mono text-[11px] text-contrast-400">↳ {item.reference}</p>
      )}
      {item.notes && (
        <p className="mt-2 border-t border-error/20 pt-2 text-xs leading-relaxed text-contrast-500">
          {item.notes}
        </p>
      )}
    </article>
  );
}

function CategoryRow({
  label,
  total,
  compliant,
  partial,
  manualReview,
  nonCompliant,
}: {
  label: string;
  total: number;
  compliant: number;
  partial: number;
  manualReview: number;
  nonCompliant: number;
}) {
  const compliantPct = total > 0 ? Math.round((compliant / total) * 100) : 0;
  return (
    <tr className="border-b border-contrast-100 last:border-b-0">
      <td className="py-2 pr-3 align-middle">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="font-mono text-[10px] text-contrast-400">{total} total</p>
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-contrast-100">
            <div
              className="h-1.5 rounded-full bg-success transition-all"
              style={{ width: `${compliantPct}%` }}
            />
          </div>
          <span className="font-mono text-xs text-contrast-500">{compliantPct}%</span>
        </div>
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-xs text-success-foreground">
        {compliant > 0 ? compliant : '—'}
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-xs text-warning-foreground">
        {partial > 0 ? partial : '—'}
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-xs text-info-foreground">
        {manualReview > 0 ? manualReview : '—'}
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-xs">
        {nonCompliant > 0 ? (
          <span className="rounded bg-error-background px-1.5 py-0.5 font-medium text-error-foreground">
            {nonCompliant}
          </span>
        ) : (
          <span className="text-contrast-400">—</span>
        )}
      </td>
    </tr>
  );
}

export function CoverageView({ state }: CoverageViewProps) {
  return (
    <div className="space-y-10">
      {/* Action-first: the 3 non-compliant items get top billing */}
      {state.nonCompliantItems.length > 0 && (
        <section aria-label="Non-compliant — needs attention">
          <div className="mb-3 flex items-baseline gap-3">
            <h3 className="font-heading text-base font-semibold tracking-tight">
              Needs attention
            </h3>
            <span className="font-mono text-xs text-contrast-400">
              {state.nonCompliantItems.length} non-compliant
            </span>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-contrast-500">
            Capabilities that failed their derivation check. Each links to the BRD / ADR / spec
            section where the contract is defined.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {state.nonCompliantItems.map((item) => (
              <NonCompliantCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Compact category table — the answer for the rest */}
      <section aria-label="Coverage by category">
        <h3 className="mb-3 font-heading text-base font-semibold tracking-tight">
          Coverage by category
        </h3>
        <div className="overflow-x-auto rounded-lg border border-contrast-200 bg-background">
          <table className="w-full">
            <thead>
              <tr className="border-b border-contrast-200 text-left">
                <th className="py-2 pl-4 pr-3 font-mono text-[10px] uppercase tracking-wide text-contrast-400">
                  Category
                </th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-contrast-400">
                  Compliant
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-success-foreground">
                  ✓
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-warning-foreground">
                  Partial
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-info-foreground">
                  Manual
                </th>
                <th className="px-2 py-2 pr-4 text-right font-mono text-[10px] uppercase tracking-wide text-error-foreground">
                  Non-compliant
                </th>
              </tr>
            </thead>
            <tbody className="px-4">
              {state.categories.map((cat) => (
                <CategoryRow
                  key={cat.category}
                  label={prettifyCategory(cat.category)}
                  total={cat.total}
                  compliant={cat.compliant}
                  partial={cat.partial}
                  manualReview={cat.manualReview}
                  nonCompliant={cat.nonCompliant}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[10px] text-contrast-400">
          ✓ check passed · Partial = some-but-not-all derivation steps passed · Manual = no
          mechanical check exists (human review supplements) · Non-compliant = check failed
        </p>
      </section>
    </div>
  );
}
