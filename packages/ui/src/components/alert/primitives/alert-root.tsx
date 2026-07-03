import { forwardRef, type ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/cn';

export const alertVariants = cva(
  cn(
    'group/alert relative flex items-start gap-3 rounded-lg border p-4',
    'data-[variant=info]:border-info data-[variant=info]:bg-info-background',
    'data-[variant=success]:border-success data-[variant=success]:bg-success-background',
    'data-[variant=warning]:border-warning data-[variant=warning]:bg-warning-background',
    'data-[variant=error]:border-error data-[variant=error]:bg-error-background',
    'data-[variant=default]:border-contrast-200 data-[variant=default]:bg-contrast-100',
  ),
  {
    variants: {
      variant: {
        default: '',
        info: '',
        success: '',
        warning: '',
        error: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertRootProps
  extends ComponentProps<'div'>,
    VariantProps<typeof alertVariants> {}

export const AlertRoot = forwardRef<HTMLDivElement, AlertRootProps>(
  function AlertRoot({ className, variant = 'default', ...props }, ref) {
    return (
      <div
        ref={ref}
        role="alert"
        data-slot="alert"
        data-variant={variant}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
