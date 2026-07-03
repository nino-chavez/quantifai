import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const taskBarVariants = cva(
  cn(
    'group/task-bar relative flex h-9 items-center gap-2 overflow-hidden rounded-md border pl-3 pr-2.5',
    'text-xs font-medium',
    'transition-all duration-fast ease-standard',
    'hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
  ),
  {
    variants: {
      status: {
        compliant: cn(
          'border-success/40 bg-success-background text-success-foreground',
          'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-success',
        ),
        partial: cn(
          'border-warning/40 bg-warning-background text-warning-foreground',
          'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-warning',
        ),
        'non-compliant': cn(
          'border-error/40 bg-error-background text-error-foreground',
          'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-error',
        ),
        'manual-review': cn(
          'border-info/40 bg-info-background text-info-foreground',
          'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-info',
        ),
        neutral: cn(
          'border-contrast-200 bg-contrast-100 text-contrast-500',
          'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-contrast-300',
        ),
      },
      density: {
        compact:   'h-7 text-[11px]',
        default:   'h-9 text-xs',
        spacious:  'h-11 text-sm',
      },
    },
    defaultVariants: {
      status: 'neutral',
      density: 'default',
    },
  },
);

export interface TaskBarProps
  extends ComponentProps<'div'>,
    VariantProps<typeof taskBarVariants> {
  label: ReactNode;
  meta?: ReactNode;
  /** 0..1 — when set, renders a progress overlay (frappe-gantt-style fill). */
  progress?: number;
}

/**
 * TaskBar — single horizontal pill representing a capability/slice within a Swimlane.
 *
 * Status drives both the fill (subtle tinted background) and a 4px leading edge marker —
 * dual-encoded so colorblind users get a positional cue, not just hue.
 *
 * The `progress` prop (0..1) overlays a darker fill on the left portion of the bar,
 * frappe-gantt-style. Use for ACs completed / scenarios passing / evidence collected.
 */
export const TaskBar = forwardRef<HTMLDivElement, TaskBarProps>(
  function TaskBar({ className, status, density, label, meta, progress, ...props }, ref) {
    const clamped = progress == null ? null : Math.max(0, Math.min(1, progress));
    return (
      <div
        ref={ref}
        data-slot="task-bar"
        data-status={status ?? 'neutral'}
        className={cn(taskBarVariants({ status, density }), className)}
        {...props}
      >
        {clamped != null && (
          <div
            aria-hidden
            data-slot="task-bar-progress"
            className="pointer-events-none absolute inset-y-0 left-0 bg-foreground/[0.06]"
            style={{ width: `${clamped * 100}%` }}
          />
        )}
        <span data-slot="task-bar-label" className="relative truncate">{label}</span>
        {meta && (
          <span
            data-slot="task-bar-meta"
            className="relative ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide opacity-70"
          >
            {meta}
          </span>
        )}
      </div>
    );
  },
);
