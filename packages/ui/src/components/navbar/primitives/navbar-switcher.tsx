import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type NavBarSwitcherProps = ComponentProps<'div'>;

/**
 * Verb switcher — horizontal list of Item chips. Five verbs + Roadmap.
 * On narrow viewports, hides via CSS and a NavBarMobileMenu (TBD) takes over.
 */
export const NavBarSwitcher = forwardRef<HTMLDivElement, NavBarSwitcherProps>(
  function NavBarSwitcher({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="navbar-switcher"
        role="navigation"
        className={cn(
          'hidden flex-1 items-center justify-center gap-1 md:flex',
          className,
        )}
        {...props}
      />
    );
  },
);
