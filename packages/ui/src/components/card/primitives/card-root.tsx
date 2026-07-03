import { forwardRef, type ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/cn';

export const cardVariants = cva(
  cn(
    'group/card relative flex flex-col gap-3 rounded-lg border bg-background text-foreground',
    'transition-shadow duration-fast ease-standard',
  ),
  {
    variants: {
      variant: {
        flat:     'border-contrast-200',
        elevated: 'border-contrast-100 shadow-sm hover:shadow-md',
        outline:  'border-contrast-300',
        ghost:    'border-transparent',
      },
      padding: {
        none: 'p-0',
        sm:   'p-3',
        md:   'p-5',
        lg:   'p-6',
      },
      interactive: {
        true: cn(
          'cursor-pointer',
          'hover:border-brand/50',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
        ),
        false: '',
      },
    },
    defaultVariants: {
      variant: 'flat',
      padding: 'md',
      interactive: false,
    },
  },
);

export interface CardRootProps
  extends ComponentProps<'div'>,
    VariantProps<typeof cardVariants> {}

export const CardRoot = forwardRef<HTMLDivElement, CardRootProps>(
  function CardRoot({ className, variant, padding, interactive, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card"
        data-variant={variant ?? 'flat'}
        data-interactive={interactive ? 'true' : 'false'}
        className={cn(cardVariants({ variant, padding, interactive }), className)}
        {...props}
      />
    );
  },
);
