import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/cn';

export interface NavBarBrandProps extends ComponentProps<'a'> {
  asChild?: boolean;
}

export const NavBarBrand = forwardRef<HTMLAnchorElement, NavBarBrandProps>(
  function NavBarBrand({ className, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : 'a';
    return (
      <Component
        ref={ref}
        data-slot="navbar-brand"
        className={cn(
          'flex items-center gap-2 font-heading text-base font-semibold text-foreground',
          'transition-colors duration-fast ease-standard',
          'hover:text-brand',
          'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          className,
        )}
        {...props}
      />
    );
  },
);
