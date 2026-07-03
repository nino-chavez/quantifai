import { forwardRef, type ReactNode } from 'react';
import { Compass, PlayCircle, Code2, SlidersHorizontal, Microscope, Map } from 'lucide-react';
import * as LaneCardPrimitive from './primitives';
import type { LaneVerb } from './primitives/lane-card-root';

const VERB_DEFAULTS: Record<LaneVerb, { label: string; icon: typeof Compass; href: string }> = {
  discover: { label: 'Discover', icon: Compass,            href: '/discover' },
  try:      { label: 'Try',      icon: PlayCircle,         href: '/try' },
  build:    { label: 'Build',    icon: Code2,              href: '/build' },
  operate:  { label: 'Operate',  icon: SlidersHorizontal,  href: '/operate' },
  inspect:  { label: 'Inspect',  icon: Microscope,         href: '/inspect' },
  roadmap:  { label: 'Roadmap',  icon: Map,                href: '/roadmap' },
};

export interface LaneCardProps extends Omit<LaneCardPrimitive.RootProps, 'children' | 'title'> {
  verb: LaneVerb;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}

/**
 * LaneCard — monolith form. Provide just `verb` to render the default
 * icon/label/href, or override individually. For custom layouts use
 * LaneCardPrimitive composables.
 */
export const LaneCard = forwardRef<HTMLAnchorElement, LaneCardProps>(
  function LaneCard(
    { verb, title, description, icon, meta, children, href, ...props },
    ref,
  ) {
    const defaults = VERB_DEFAULTS[verb];
    const DefaultIcon = defaults.icon;

    return (
      <LaneCardPrimitive.Root
        ref={ref}
        verb={verb}
        href={href ?? defaults.href}
        {...props}
      >
        <LaneCardPrimitive.Icon asChild={Boolean(icon)}>
          {icon ?? <DefaultIcon />}
        </LaneCardPrimitive.Icon>
        <LaneCardPrimitive.Title>{title ?? defaults.label}</LaneCardPrimitive.Title>
        {description && (
          <LaneCardPrimitive.Description>{description}</LaneCardPrimitive.Description>
        )}
        {children}
        {meta && <LaneCardPrimitive.Meta>{meta}</LaneCardPrimitive.Meta>}
      </LaneCardPrimitive.Root>
    );
  },
);
