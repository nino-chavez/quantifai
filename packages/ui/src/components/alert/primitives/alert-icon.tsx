import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/cn';

export interface AlertIconProps extends ComponentProps<'span'> {
  asChild?: boolean;
}

export const AlertIcon = forwardRef<HTMLSpanElement, AlertIconProps>(
  function AlertIcon({ className, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : 'span';
    return (
      <Component
        ref={ref}
        data-slot="alert-icon"
        aria-hidden="true"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center',
          'group-data-[variant=info]/alert:text-info',
          'group-data-[variant=success]/alert:text-success',
          'group-data-[variant=warning]/alert:text-warning',
          'group-data-[variant=error]/alert:text-error',
          'group-data-[variant=default]/alert:text-contrast-500',
          className,
        )}
        {...props}
      />
    );
  },
);
