import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export interface ShellHeaderProps extends ComponentProps<'header'> {
  sticky?: boolean;
}

export const ShellHeader = forwardRef<HTMLElement, ShellHeaderProps>(
  function ShellHeader({ className, sticky = true, ...props }, ref) {
    return (
      <header
        ref={ref}
        data-slot="shell-header"
        data-sticky={sticky ? 'true' : 'false'}
        className={cn(
          'z-40 w-full border-b border-contrast-100 bg-background/80 backdrop-blur',
          sticky && 'sticky top-0',
          className,
        )}
        {...props}
      />
    );
  },
);
