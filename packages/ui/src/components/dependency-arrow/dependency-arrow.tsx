import { forwardRef, type SVGProps } from 'react';
import { cn } from '../../lib/cn';

export interface DependencyArrowProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'from' | 'to'> {
  /** Starting point in the parent's coordinate space. */
  from: { x: number; y: number };
  /** Ending point in the parent's coordinate space. */
  to: { x: number; y: number };
  /** Corner radius for the elbow joint. Default 8. */
  radius?: number;
  /** Stroke tone — maps to design-token colors. Default 'contrast'. */
  tone?: 'contrast' | 'brand' | 'warning' | 'error';
}

const TONE_STROKE: Record<NonNullable<DependencyArrowProps['tone']>, string> = {
  contrast: 'stroke-contrast-300',
  brand:    'stroke-brand',
  warning:  'stroke-warning',
  error:    'stroke-error',
};

const TONE_FILL: Record<NonNullable<DependencyArrowProps['tone']>, string> = {
  contrast: 'fill-contrast-300',
  brand:    'fill-brand',
  warning:  'fill-warning',
  error:    'fill-error',
};

/**
 * DependencyArrow — rounded right-angle connector between two task bars.
 *
 * Frappe-gantt-style routing: horizontal from origin → vertical mid-step → horizontal
 * to target, with smoothly-arced corners. Never diagonal. The arrow renders absolutely;
 * the parent must be `position: relative` with the same coordinate space as `from`/`to`.
 *
 * Usage: measure two TaskBar bounding rects (relative to a positioned container),
 * pass their edge midpoints as `from` and `to`.
 */
export const DependencyArrow = forwardRef<SVGSVGElement, DependencyArrowProps>(
  function DependencyArrow({ from, to, radius = 8, tone = 'contrast', className, ...props }, ref) {
    const minX = Math.min(from.x, to.x) - 12;
    const minY = Math.min(from.y, to.y) - 12;
    const maxX = Math.max(from.x, to.x) + 12;
    const maxY = Math.max(from.y, to.y) + 12;
    const width = maxX - minX;
    const height = maxY - minY;

    // Local coords (svg-space)
    const ax = from.x - minX;
    const ay = from.y - minY;
    const bx = to.x - minX;
    const by = to.y - minY;

    // Step out from `from` by min 24px, then route vertically, then into `to`.
    const stepX = ax + Math.max(24, (bx - ax) / 2);
    const yDir = by > ay ? 1 : -1;
    const r = Math.min(radius, Math.abs(by - ay) / 2);

    // Path: M ax,ay → H stepX-r → arc → V by-r*yDir → arc → H bx
    const d = [
      `M ${ax} ${ay}`,
      `H ${stepX - r}`,
      `Q ${stepX} ${ay} ${stepX} ${ay + r * yDir}`,
      `V ${by - r * yDir}`,
      `Q ${stepX} ${by} ${stepX + r} ${by}`,
      `H ${bx}`,
    ].join(' ');

    // Arrowhead at (bx, by), pointing right.
    const head = `M ${bx} ${by} l -6 -3 l 0 6 z`;

    return (
      <svg
        ref={ref}
        data-slot="dependency-arrow"
        data-tone={tone}
        aria-hidden
        className={cn('pointer-events-none absolute', className)}
        style={{ left: minX, top: minY, width, height }}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        {...props}
      >
        <path
          d={d}
          strokeWidth={1.5}
          strokeLinecap="round"
          className={cn(TONE_STROKE[tone], 'opacity-70')}
        />
        <path d={head} className={cn(TONE_FILL[tone], 'opacity-70')} />
      </svg>
    );
  },
);
