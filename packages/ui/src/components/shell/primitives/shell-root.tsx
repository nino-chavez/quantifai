import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type ShellRootProps = ComponentProps<'div'>;

/**
 * Shell root — top-level page chrome that wraps every portal surface.
 * Compose with ShellHeader / ShellMain / ShellFooter (or just ShellMain for
 * borderless surfaces like embedded demos).
 */
export const ShellRoot = forwardRef<HTMLDivElement, ShellRootProps>(
  function ShellRoot({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="shell"
        className={cn(
          'group/shell flex min-h-screen flex-col bg-background text-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);
