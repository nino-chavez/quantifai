import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/cn';

export const LANE_VERBS = [
  'discover',
  'try',
  'build',
  'operate',
  'inspect',
  'roadmap',
] as const;
export type LaneVerb = (typeof LANE_VERBS)[number];

export interface LaneCardRootProps extends ComponentProps<'a'> {
  asChild?: boolean;
  verb?: LaneVerb;
}

/**
 * LaneCard — clickable tile for one of the portal's five verbs (+ Roadmap).
 * Renders as <a> by default; consumers swap routing via asChild.
 *
 * The `verb` attribute sets a data attribute that child primitives style
 * against (icon tinting, accent borders, etc.) — same group/data pattern as
 * Alert variants.
 */
export const LaneCardRoot = forwardRef<HTMLAnchorElement, LaneCardRootProps>(
  function LaneCardRoot({ className, asChild = false, verb, ...props }, ref) {
    const Component = asChild ? Slot : 'a';
    return (
      <Component
        ref={ref}
        data-slot="lane-card"
        data-verb={verb ?? 'discover'}
        className={cn(
          'group/lane-card relative flex flex-col gap-3 rounded-lg border border-contrast-200 bg-background p-5',
          'transition-all duration-normal ease-standard',
          'hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-md',
          'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          className,
        )}
        {...props}
      />
    );
  },
);
