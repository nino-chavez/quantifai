import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export interface ShellMainProps extends ComponentProps<'main'> {
  contained?: boolean;
}

export const ShellMain = forwardRef<HTMLElement, ShellMainProps>(
  function ShellMain({ className, contained = true, ...props }, ref) {
    return (
      <main
        ref={ref}
        data-slot="shell-main"
        data-contained={contained ? 'true' : 'false'}
        className={cn(
          'flex-1',
          contained && 'mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 lg:px-8',
          className,
        )}
        {...props}
      />
    );
  },
);
