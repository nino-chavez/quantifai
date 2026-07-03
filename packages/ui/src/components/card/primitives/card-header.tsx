import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type CardHeaderProps = ComponentProps<'div'>;

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-header"
        className={cn('flex flex-col gap-1.5', className)}
        {...props}
      />
    );
  },
);
