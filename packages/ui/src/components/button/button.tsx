import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  cn(
    'group/button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    'transition-colors duration-fast ease-standard',
    'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        primary:     'bg-brand text-brand-foreground hover:bg-brand/90',
        secondary:   'bg-contrast-100 text-foreground hover:bg-contrast-200',
        outline:     'border border-contrast-300 bg-transparent text-foreground hover:bg-contrast-100',
        ghost:       'bg-transparent text-foreground hover:bg-contrast-100',
        destructive: 'bg-error text-white hover:bg-error/90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        data-slot="button"
        data-variant={variant ?? 'primary'}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
