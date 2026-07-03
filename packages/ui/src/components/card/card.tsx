import { forwardRef, type ReactNode } from 'react';
import * as CardPrimitive from './primitives';

export interface CardProps extends Omit<CardPrimitive.RootProps, 'children' | 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Card — monolith form. For custom layouts, use the CardPrimitive composables.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card({ title, description, footer, children, ...props }, ref) {
    return (
      <CardPrimitive.Root ref={ref} {...props}>
        {(title || description) && (
          <CardPrimitive.Header>
            {title && <CardPrimitive.Title>{title}</CardPrimitive.Title>}
            {description && <CardPrimitive.Description>{description}</CardPrimitive.Description>}
          </CardPrimitive.Header>
        )}
        {children && <CardPrimitive.Content>{children}</CardPrimitive.Content>}
        {footer && <CardPrimitive.Footer>{footer}</CardPrimitive.Footer>}
      </CardPrimitive.Root>
    );
  },
);
