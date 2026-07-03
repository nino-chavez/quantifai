import { forwardRef, type ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/cn';

export interface NavBarItemProps extends ComponentProps<'a'> {
  asChild?: boolean;
  active?: boolean;
}

export const NavBarItem = forwardRef<HTMLAnchorElement, NavBarItemProps>(
  function NavBarItem({ className, asChild = false, active = false, ...props }, ref) {
    const Component = asChild ? Slot : 'a';
    return (
      <Component
        ref={ref}
        data-slot="navbar-item"
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium',
          'transition-colors duration-fast ease-standard',
          'text-contrast-500 hover:bg-contrast-100 hover:text-foreground',
          'data-[active=true]:bg-brand-background data-[active=true]:text-brand-foreground',
          'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          className,
        )}
        {...props}
      />
    );
  },
);
