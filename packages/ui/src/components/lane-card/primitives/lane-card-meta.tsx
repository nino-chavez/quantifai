import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type LaneCardMetaProps = ComponentProps<'div'>;

export const LaneCardMeta = forwardRef<HTMLDivElement, LaneCardMetaProps>(
  function LaneCardMeta({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="lane-card-meta"
        className={cn('mt-auto flex items-center gap-2 pt-2 text-xs text-contrast-400', className)}
        {...props}
      />
    );
  },
);
