import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type LaneCardDescriptionProps = ComponentProps<'p'>;

export const LaneCardDescription = forwardRef<HTMLParagraphElement, LaneCardDescriptionProps>(
  function LaneCardDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="lane-card-description"
        className={cn('text-sm leading-relaxed text-contrast-500', className)}
        {...props}
      />
    );
  },
);
