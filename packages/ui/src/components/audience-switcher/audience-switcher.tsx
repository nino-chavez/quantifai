import { forwardRef, type ComponentProps } from 'react';
import { Briefcase, Compass, Wrench } from 'lucide-react';
import { cn } from '../../lib/cn';
import { AUDIENCES, type Audience } from './use-audience-preference';
export type { Audience } from './use-audience-preference';

const AUDIENCE_META: Record<Audience, { label: string; icon: typeof Briefcase; hint: string }> = {
  executive: {
    label: 'Executive',
    icon: Briefcase,
    hint: 'Strategy-first walkthrough',
  },
  evaluator: {
    label: 'Evaluator',
    icon: Compass,
    hint: 'Hands-on / trial evaluation',
  },
  engineering: {
    label: 'Engineering',
    icon: Wrench,
    hint: 'Methodology + behind-the-scenes',
  },
};

export interface AudienceSwitcherProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  value: Audience;
  onChange: (next: Audience) => void;
}

/**
 * Chip-group selector for the audience mode. Three options:
 * executive / evaluator / engineering. Lane order in the portal shifts based
 * on the selection.
 *
 * State lives outside — usually via `useAudiencePreference` for persistence:
 *
 *   const [audience, setAudience] = useAudiencePreference();
 *   <AudienceSwitcher value={audience} onChange={setAudience} />
 */
export const AudienceSwitcher = forwardRef<HTMLDivElement, AudienceSwitcherProps>(
  function AudienceSwitcher({ value, onChange, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="audience-switcher"
        role="radiogroup"
        aria-label="Audience mode"
        className={cn(
          'group/audience-switcher inline-flex items-center gap-0.5 rounded-md bg-contrast-100 p-0.5',
          className,
        )}
        {...props}
      >
        {AUDIENCES.map((audience) => {
          const { label, icon: Icon, hint } = AUDIENCE_META[audience];
          const active = audience === value;
          return (
            <button
              key={audience}
              type="button"
              role="radio"
              aria-checked={active}
              data-slot="audience-switcher-option"
              data-audience={audience}
              data-active={active ? 'true' : 'false'}
              onClick={() => onChange(audience)}
              title={hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium',
                'transition-all duration-fast ease-standard',
                'text-contrast-500 hover:text-foreground',
                'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                active && 'bg-background text-foreground shadow-sm',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>
    );
  },
);
