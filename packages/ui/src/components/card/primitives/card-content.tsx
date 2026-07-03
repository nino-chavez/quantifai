import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type CardContentProps = ComponentProps<'div'>;

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  function CardContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-content"
        className={cn('flex-1', className)}
        {...props}
      />
    );
  },
);
