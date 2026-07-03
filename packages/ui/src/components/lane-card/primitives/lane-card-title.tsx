import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type LaneCardTitleProps = ComponentProps<'h3'>;

export const LaneCardTitle = forwardRef<HTMLHeadingElement, LaneCardTitleProps>(
  function LaneCardTitle({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        data-slot="lane-card-title"
        className={cn(
          'font-heading text-lg font-semibold leading-tight tracking-tight text-foreground',
          'transition-colors duration-fast ease-standard',
          'group-hover/lane-card:text-brand',
          className,
        )}
        {...props}
      />
    );
  },
);
