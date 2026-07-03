import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type CardFooterProps = ComponentProps<'div'>;

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-footer"
        className={cn('flex items-center justify-between pt-2', className)}
        {...props}
      />
    );
  },
);
