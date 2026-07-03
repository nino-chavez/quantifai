import { Swimlane, TaskBar } from '@blueprint/ui';
import type { StateSummary, DerivedStatus } from '@/lib/derived';
import { prettifyCategory } from '@/lib/derived';

export interface DerivedRoadmapProps {
  state: StateSummary;
}

const STATUS_TO_TASKBAR_STATUS: Record<
  DerivedStatus,
  'compliant' | 'partial' | 'non-compliant' | 'manual-review'
> = {
  'compliant':      'compliant',
  'partial':        'partial',
  'non-compliant':  'non-compliant',
  'manual-review':  'manual-review',
};

/**
 * Capability coverage swimlanes — one per category. Each rail shows
 * aggregate counts; the track shows the top 8 capabilities prioritized
 * by status (non-compliant first → partial → manual-review → compliant).
 *
 * Retrospective only. Forward-looking data lives on /roadmap.
 */
export function DerivedRoadmap({ state }: DerivedRoadmapProps) {
  return (
    <section
      aria-label="Coverage swimlanes"
      className="rounded-lg border border-contrast-200 bg-background p-2"
    >
      {state.categories.map((cat) => (
        <Swimlane
          key={cat.category}
          label={prettifyCategory(cat.category)}
          sublabel={`${cat.total} total`}
          counts={{
            compliant: cat.compliant,
            partial: cat.partial,
            nonCompliant: cat.nonCompliant,
            manualReview: cat.manualReview,
          }}
        >
          {cat.sample.map((capability) => (
            <TaskBar
              key={capability.id}
              label={capability.id}
              status={STATUS_TO_TASKBAR_STATUS[capability.status]}
              meta={capability.status === 'compliant' ? '✓' : capability.status}
              title={capability.description}
            />
          ))}
          {cat.total > cat.sample.length && (
            <TaskBar
              label={`${cat.total - cat.sample.length} more — see _state.json`}
              status="neutral"
              density="compact"
            />
          )}
        </Swimlane>
      ))}
    </section>
  );
}
