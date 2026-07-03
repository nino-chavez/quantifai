import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type AlertTitleProps = ComponentProps<'h5'>;

export const AlertTitle = forwardRef<HTMLHeadingElement, AlertTitleProps>(
  function AlertTitle({ className, ...props }, ref) {
    return (
      <h5
        ref={ref}
        data-slot="alert-title"
        className={cn(
          'mb-1 font-heading text-sm font-semibold leading-none',
          'group-data-[variant=info]/alert:text-info-foreground',
          'group-data-[variant=success]/alert:text-success-foreground',
          'group-data-[variant=warning]/alert:text-warning-foreground',
          'group-data-[variant=error]/alert:text-error-foreground',
          'group-data-[variant=default]/alert:text-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);
