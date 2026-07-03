import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type ShellFooterProps = ComponentProps<'footer'>;

export const ShellFooter = forwardRef<HTMLElement, ShellFooterProps>(
  function ShellFooter({ className, ...props }, ref) {
    return (
      <footer
        ref={ref}
        data-slot="shell-footer"
        className={cn(
          'border-t border-contrast-100 bg-contrast-100/30',
          'mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 lg:px-8',
          'text-sm text-contrast-500',
          className,
        )}
        {...props}
      />
    );
  },
);
