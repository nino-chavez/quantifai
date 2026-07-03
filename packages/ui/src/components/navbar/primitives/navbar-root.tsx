import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type NavBarRootProps = ComponentProps<'nav'>;

/**
 * Top-bar navigation root — sits inside Shell.Header. Layouts a brand
 * area on the left, a verb switcher in the middle, and actions on the right.
 */
export const NavBarRoot = forwardRef<HTMLElement, NavBarRootProps>(
  function NavBarRoot({ className, ...props }, ref) {
    return (
      <nav
        ref={ref}
        data-slot="navbar"
        className={cn(
          'group/navbar mx-auto flex h-16 w-full max-w-screen-xl items-center gap-6 px-4 sm:px-6 lg:px-8',
          className,
        )}
        {...props}
      />
    );
  },
);
