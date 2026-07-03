/**
 * Alert primitives — composable API for custom layouts.
 *
 * Usage:
 *
 *   import * as AlertPrimitive from '@blueprint/ui/alert';
 *
 *   <AlertPrimitive.Root variant="warning">
 *     <AlertPrimitive.Icon><CustomIcon /></AlertPrimitive.Icon>
 *     <div>
 *       <AlertPrimitive.Title>Heads up</AlertPrimitive.Title>
 *       <AlertPrimitive.Body>Something to know about.</AlertPrimitive.Body>
 *     </div>
 *   </AlertPrimitive.Root>
 *
 * For the simple case, use the `<Alert>` monolith from the same import.
 */

export {
  AlertRoot as Root,
  alertVariants,
  type AlertRootProps as RootProps,
} from './primitives/alert-root';
export { AlertIcon as Icon, type AlertIconProps as IconProps } from './primitives/alert-icon';
export { AlertTitle as Title, type AlertTitleProps as TitleProps } from './primitives/alert-title';
export { AlertBody as Body, type AlertBodyProps as BodyProps } from './primitives/alert-body';
