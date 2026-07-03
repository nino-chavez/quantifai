/**
 * @blueprint/ui — public surface
 *
 * Monolith exports — single-import, props-driven API. Tree-shakeable when
 * consumers use named imports.
 *
 * For composable usage (custom layouts), import from the per-component
 * subpath instead:
 *
 *   import * as AlertPrimitive from '@blueprint/ui/alert';
 */

// Generic kit
export { Button, buttonVariants, type ButtonProps } from './components/button';
export { Badge, badgeVariants, type BadgeProps } from './components/badge';
export { Alert, type AlertProps } from './components/alert';
export { Card, type CardProps } from './components/card';

// Portal shell + nav
export {
  AudienceSwitcher,
  useAudiencePreference,
  AUDIENCES,
  type Audience,
  type AudienceSwitcherProps,
} from './components/audience-switcher';
export {
  StatusBadge,
  STATUS_VALUES,
  type Status,
  type StatusBadgeProps,
} from './components/status-badge';
export {
  LaneCard,
  LANE_VERBS,
  type LaneCardProps,
  type LaneVerb,
} from './components/lane-card';

// Roadmap visualization (frappe-gantt-style)
export {
  Swimlane,
  swimlaneVariants,
  type SwimlaneProps,
  type SwimlaneCount,
} from './components/swimlane';
export { TaskBar, taskBarVariants, type TaskBarProps } from './components/task-bar';
export { DependencyArrow, type DependencyArrowProps } from './components/dependency-arrow';

// Live embeds
export { LiveIframe, type LiveIframeProps } from './components/live-iframe';

export { cn } from './lib/cn';
