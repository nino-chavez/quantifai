import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const swimlaneVariants = cva(
  cn(
    'group/swimlane relative grid grid-cols-[12rem_1fr] gap-x-4 border-t border-contrast-200',
    'first:border-t-0',
  ),
  {
    variants: {
      density: {
        compact:  'py-2',
        default:  'py-3',
        spacious: 'py-4',
      },
      banded: {
        true:  'odd:bg-contrast-100/40',
        false: '',
      },
    },
    defaultVariants: {
      density: 'default',
      banded: true,
    },
  },
);

export interface SwimlaneCount {
  compliant?: number;
  partial?: number;
  nonCompliant?: number;
  manualReview?: number;
}

export interface SwimlaneProps
  extends ComponentProps<'div'>,
    VariantProps<typeof swimlaneVariants> {
  /** Category label — left rail. */
  label: ReactNode;
  /** Optional sublabel (e.g. ADR ref, doc anchor). */
  sublabel?: ReactNode;
  /** Optional status-count badges rendered under the label. */
  counts?: SwimlaneCount;
  /** Track content — typically a horizontally-wrapping row of TaskBars. */
  children?: ReactNode;
}

const COUNT_TONES = {
  compliant:    'bg-success/15 text-success-foreground',
  partial:      'bg-warning/15 text-warning-foreground',
  nonCompliant: 'bg-error/15 text-error-foreground',
  manualReview: 'bg-info/15 text-info-foreground',
} as const;

const COUNT_GLYPHS = {
  compliant:    '✓',
  partial:      '◐',
  nonCompliant: '✕',
  manualReview: '?',
} as const;

/**
 * Swimlane — horizontal band grouping related TaskBars by category, phase, or gating tier.
 *
 * Left rail carries the category label, optional sublabel, and count chips by status.
 * Right track is freeform — drop TaskBars in flex-wrap, or any other layout.
 *
 * The banded variant alternates row backgrounds (every-other contrast-100), the same
 * weekend-banding trick frappe-gantt uses for visual rhythm at scale.
 */
export const Swimlane = forwardRef<HTMLDivElement, SwimlaneProps>(
  function Swimlane({ className, density, banded, label, sublabel, counts, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="swimlane"
        className={cn(swimlaneVariants({ density, banded }), className)}
        {...props}
      >
        <div data-slot="swimlane-rail" className="flex flex-col gap-1.5 pl-4">
          <div className="text-sm font-semibold leading-tight text-foreground">{label}</div>
          {sublabel && (
            <div className="font-mono text-[10px] uppercase tracking-wide text-contrast-400">
              {sublabel}
            </div>
          )}
          {counts && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(Object.keys(COUNT_GLYPHS) as Array<keyof typeof COUNT_GLYPHS>).map((key) => {
                const n = counts[key];
                if (!n) return null;
                return (
                  <span
                    key={key}
                    data-slot="swimlane-count"
                    data-status={key}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
                      COUNT_TONES[key],
                    )}
                  >
                    <span aria-hidden>{COUNT_GLYPHS[key]}</span>
                    {n}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div data-slot="swimlane-track" className="flex flex-wrap content-start gap-1.5 pr-4">
          {children}
        </div>
      </div>
    );
  },
);
