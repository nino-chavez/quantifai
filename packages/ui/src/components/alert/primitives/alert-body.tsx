import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type AlertBodyProps = ComponentProps<'div'>;

export const AlertBody = forwardRef<HTMLDivElement, AlertBodyProps>(
  function AlertBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="alert-body"
        className={cn(
          'flex-1 text-sm leading-relaxed',
          'group-data-[variant=info]/alert:text-info-foreground/90',
          'group-data-[variant=success]/alert:text-success-foreground/90',
          'group-data-[variant=warning]/alert:text-warning-foreground/90',
          'group-data-[variant=error]/alert:text-error-foreground/90',
          'group-data-[variant=default]/alert:text-contrast-500',
          className,
        )}
        {...props}
      />
    );
  },
);
