import { forwardRef, type ComponentProps } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn';

/**
 * Tabs — composable wrapper around Radix Tabs. No monolith form;
 * tabs are inherently composable.
 *
 *   import * as Tabs from '@blueprint/ui/tabs';
 *
 *   <Tabs.Root defaultValue="dev">
 *     <Tabs.List>
 *       <Tabs.Trigger value="dev">Developer</Tabs.Trigger>
 *       <Tabs.Trigger value="merchant">Merchant</Tabs.Trigger>
 *       <Tabs.Trigger value="customer">Customer</Tabs.Trigger>
 *     </Tabs.List>
 *     <Tabs.Content value="dev">…</Tabs.Content>
 *     <Tabs.Content value="merchant">…</Tabs.Content>
 *     <Tabs.Content value="customer">…</Tabs.Content>
 *   </Tabs.Root>
 */

export const Root = TabsPrimitive.Root;

export const List = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        'group/tabs-list inline-flex items-center gap-1 rounded-md bg-contrast-100 p-1',
        className,
      )}
      {...props}
    />
  );
});

export const Trigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium',
        'transition-all duration-fast ease-standard',
        'text-contrast-500 hover:text-foreground',
        'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

export const Content = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      data-slot="tabs-content"
      className={cn(
        'mt-4 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        className,
      )}
      {...props}
    />
  );
});
