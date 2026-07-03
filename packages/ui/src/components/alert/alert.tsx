import { forwardRef, type ReactNode } from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle, Bell } from 'lucide-react';
import * as AlertPrimitive from './primitives';
import type { VariantProps } from 'class-variance-authority';

const defaultIcons = {
  default: Bell,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export interface AlertProps
  extends Omit<AlertPrimitive.RootProps, 'children' | 'title'>,
    VariantProps<typeof AlertPrimitive.alertVariants> {
  title?: ReactNode;
  message?: ReactNode;
  icon?: ReactNode;
  showIcon?: boolean;
  children?: ReactNode;
}

/**
 * Alert — monolith form. For custom layouts, use the AlertPrimitive composables.
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  function Alert(
    { variant = 'default', title, message, icon, showIcon = true, children, ...props },
    ref,
  ) {
    const DefaultIcon = defaultIcons[variant ?? 'default'];

    return (
      <AlertPrimitive.Root ref={ref} variant={variant} {...props}>
        {showIcon && (
          <AlertPrimitive.Icon asChild={Boolean(icon)}>
            {icon ?? <DefaultIcon />}
          </AlertPrimitive.Icon>
        )}
        <div className="flex-1">
          {title && <AlertPrimitive.Title>{title}</AlertPrimitive.Title>}
          {message && <AlertPrimitive.Body>{message}</AlertPrimitive.Body>}
          {children}
        </div>
      </AlertPrimitive.Root>
    );
  },
);
