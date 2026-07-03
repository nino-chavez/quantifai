/**
 * LaneCard primitives — composable lane teaser tile.
 *
 *   import * as LaneCard from '@blueprint/ui/lane-card';
 *   import { Compass } from 'lucide-react';
 *
 *   <LaneCard.Root href="/discover" verb="discover">
 *     <LaneCard.Icon><Compass /></LaneCard.Icon>
 *     <LaneCard.Title>Discover</LaneCard.Title>
 *     <LaneCard.Description>North star, value prop, what's the bet.</LaneCard.Description>
 *     <LaneCard.Meta>
 *       <StatusBadge status="ready" /> · 3 sections
 *     </LaneCard.Meta>
 *   </LaneCard.Root>
 */

export {
  LaneCardRoot as Root,
  LANE_VERBS,
  type LaneCardRootProps as RootProps,
  type LaneVerb,
} from './primitives/lane-card-root';
export { LaneCardIcon as Icon, type LaneCardIconProps as IconProps } from './primitives/lane-card-icon';
export { LaneCardTitle as Title, type LaneCardTitleProps as TitleProps } from './primitives/lane-card-title';
export { LaneCardDescription as Description, type LaneCardDescriptionProps as DescriptionProps } from './primitives/lane-card-description';
export { LaneCardMeta as Meta, type LaneCardMetaProps as MetaProps } from './primitives/lane-card-meta';
