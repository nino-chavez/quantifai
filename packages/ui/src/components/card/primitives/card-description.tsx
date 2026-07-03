import { forwardRef, type ComponentProps } from 'react';
import { cn } from '../../../lib/cn';

export type CardDescriptionProps = ComponentProps<'p'>;

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="card-description"
        className={cn('text-sm leading-relaxed text-contrast-500', className)}
        {...props}
      />
    );
  },
);
