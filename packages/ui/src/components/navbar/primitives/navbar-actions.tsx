import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type NavBarActionsProps = ComponentProps<'div'>;

export const NavBarActions = forwardRef<HTMLDivElement, NavBarActionsProps>(
  function NavBarActions({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="navbar-actions"
        className={cn('flex items-center gap-2', className)}
        {...props}
      />
    );
  },
);
