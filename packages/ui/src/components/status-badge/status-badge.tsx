import { forwardRef, type ComponentProps } from 'react';
import { CheckCircle2, Circle, AlertCircle, MinusCircle, Sparkles } from 'lucide-react';
import { Badge, type BadgeProps } from '../badge';
import { cn } from '../../lib/cn';

export const STATUS_VALUES = [
  'ready',
  'partial',
  'missing',
  'not-applicable',
  'planned',
] as const;
export type Status = (typeof STATUS_VALUES)[number];

const STATUS_META: Record<
  Status,
  { tone: BadgeProps['tone']; label: string; icon: typeof CheckCircle2 }
> = {
  ready:            { tone: 'success', label: 'Ready',    icon: CheckCircle2 },
  partial:          { tone: 'warning', label: 'Partial',  icon: AlertCircle },
  missing:          { tone: 'neutral', label: 'Missing',  icon: Circle },
  'not-applicable': { tone: 'neutral', label: 'N/A',      icon: MinusCircle },
  planned:          { tone: 'info',    label: 'Planned',  icon: Sparkles },
};

export interface StatusBadgeProps extends Omit<ComponentProps<typeof Badge>, 'tone' | 'children'> {
  status: Status;
  label?: string;
  showIcon?: boolean;
}

/**
 * StatusBadge — derives tone + label from one of the five state values
 * emitted by tools/state-derive. Keeps badge styling in sync across every
 * "What's Built" surface in the portal.
 */
export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge({ status, label, showIcon = true, className, ...props }, ref) {
    const meta = STATUS_META[status];
    const Icon = meta.icon;
    return (
      <Badge
        ref={ref}
        tone={meta.tone}
        data-status={status}
        className={cn('gap-1', className)}
        {...props}
      >
        {showIcon && <Icon className="h-3 w-3" aria-hidden="true" />}
        {label ?? meta.label}
      </Badge>
    );
  },
);
