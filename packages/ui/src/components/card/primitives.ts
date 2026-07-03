/**
 * Card primitives — composable API for custom layouts.
 *
 *   import * as CardPrimitive from '@blueprint/ui/card';
 *
 *   <CardPrimitive.Root variant="elevated" interactive>
 *     <CardPrimitive.Header>
 *       <CardPrimitive.Title>Strategy lane</CardPrimitive.Title>
 *       <CardPrimitive.Description>North star, value prop, PRD/BRD/STRATEGY.</CardPrimitive.Description>
 *     </CardPrimitive.Header>
 *     <CardPrimitive.Content>Body</CardPrimitive.Content>
 *     <CardPrimitive.Footer><Button>Read</Button></CardPrimitive.Footer>
 *   </CardPrimitive.Root>
 */

export {
  CardRoot as Root,
  cardVariants,
  type CardRootProps as RootProps,
} from './primitives/card-root';
export { CardHeader as Header, type CardHeaderProps as HeaderProps } from './primitives/card-header';
export { CardTitle as Title, type CardTitleProps as TitleProps } from './primitives/card-title';
export { CardDescription as Description, type CardDescriptionProps as DescriptionProps } from './primitives/card-description';
export { CardContent as Content, type CardContentProps as ContentProps } from './primitives/card-content';
export { CardFooter as Footer, type CardFooterProps as FooterProps } from './primitives/card-footer';
