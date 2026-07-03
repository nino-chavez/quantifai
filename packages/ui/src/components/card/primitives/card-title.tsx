import { forwardRef, type ComponentProps, type ElementType } from 'react';
import { cn } from '../../../lib/cn';

export interface CardTitleProps extends ComponentProps<'h3'> {
  as?: ElementType;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  function CardTitle({ className, as: Component = 'h3', ...props }, ref) {
    return (
      <Component
        ref={ref}
        data-slot="card-title"
        className={cn(
          'font-heading text-lg font-semibold leading-tight tracking-tight text-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);
