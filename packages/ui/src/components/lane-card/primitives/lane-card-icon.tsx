import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/cn';

export interface LaneCardIconProps extends ComponentProps<'div'> {
  asChild?: boolean;
}

export const LaneCardIcon = forwardRef<HTMLDivElement, LaneCardIconProps>(
  function LaneCardIcon({ className, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : 'div';
    return (
      <Component
        ref={ref}
        data-slot="lane-card-icon"
        aria-hidden="true"
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-md',
          'bg-brand-background text-brand transition-colors duration-fast ease-standard',
          'group-hover/lane-card:bg-brand group-hover/lane-card:text-brand-foreground',
          '[&>svg]:h-5 [&>svg]:w-5',
          className,
        )}
        {...props}
      />
    );
  },
);
