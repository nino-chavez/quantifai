import { forwardRef, type ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
    'transition-colors duration-fast ease-standard',
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-contrast-100 text-contrast-500',
        brand:   'bg-brand-background text-brand-foreground',
        success: 'bg-success-background text-success-foreground',
        error:   'bg-error-background text-error-foreground',
        warning: 'bg-warning-background text-warning-foreground',
        info:    'bg-info-background text-info-foreground',
      },
      size: {
        sm: 'px-2 py-0.5 text-[10px]',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
);

export interface BadgeProps
  extends ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge({ className, tone, size, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="badge"
        data-tone={tone ?? 'neutral'}
        className={cn(badgeVariants({ tone, size }), className)}
        {...props}
      />
    );
  },
);
