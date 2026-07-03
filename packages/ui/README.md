# @blueprint/ui

Shared React component library for the quantifai-next family. Patterns adapted from a commercial storefront kit (React + Tailwind + Radix + CVA), tuned for our portfolio: portal, prototype, storefront-catalyst, subscriber portal, admin.

## Dual API: Monolith + Composable

Every non-trivial component ships two surfaces. Pick whichever fits the consumer:

**Monolith** — single import, props-driven. Best for "I just need an alert here":

```tsx
import { Alert } from '@blueprint/ui';

<Alert variant="warning" title="Heads up" message="Something to know about." />
```

**Composable** — primitives for custom layouts. Best for "I need an alert with a custom header bar and footer actions":

```tsx
import * as AlertPrimitive from '@blueprint/ui/alert';

<AlertPrimitive.Root variant="warning">
  <AlertPrimitive.Icon><CustomIcon /></AlertPrimitive.Icon>
  <div className="flex-1">
    <header className="flex items-center justify-between">
      <AlertPrimitive.Title>Heads up</AlertPrimitive.Title>
      <Badge tone="warning">Action required</Badge>
    </header>
    <AlertPrimitive.Body>Something to know about.</AlertPrimitive.Body>
    <footer className="mt-3 flex gap-2">
      <Button variant="outline" size="sm">Dismiss</Button>
      <Button variant="primary" size="sm">Fix it</Button>
    </footer>
  </div>
</AlertPrimitive.Root>
```

The monolith composes the primitives internally — no duplication.

## Patterns enforced

| Pattern | What it means | Why |
|---------|---------------|-----|
| `data-slot="component-part"` | Every primitive carries it | Lets parents target children via `data-slot` selectors without class collisions |
| Named Tailwind groups (`group/alert`) | Never bare `group` | Prevents collisions when we nest (shell wraps card wraps alert) |
| `asChild` on links/icons | Via Radix `Slot` | Consumers swap in `next/link`, framework-specific routers, custom icons |
| CVA + VariantProps | All variants typed | Zero runtime overhead, type-safe variant inputs |
| `cn()` for classNames | clsx + tailwind-merge | Predictable conflict resolution; user `className` always wins |
| `focus-visible` only | Never `focus:outline-none` without replacement | Keyboard navigability is non-negotiable |

## Setup

In a consuming app's Tailwind config:

```ts
// tailwind.config.ts
import bcsPreset from '@blueprint/design-tokens/tailwind';

export default {
  presets: [bcsPreset],
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@blueprint/ui/src/**/*.{ts,tsx}',
  ],
};
```

At the app entry point:

```ts
import '@blueprint/design-tokens/css';
import '@blueprint/ui/styles';
```

## Component inventory (in progress)

| Component | API | Status |
|-----------|-----|--------|
| Button | Monolith | scaffolded |
| Badge | Monolith | scaffolded |
| Alert | Monolith + Composable | scaffolded |
| Card | Monolith + Composable | planned |
| Tabs | Composable (Radix wrapper) | planned |
| Modal | Composable (Radix wrapper) | planned |
| Shell (family chrome) | Composable | planned (Slice 1) |
| NavBar | Monolith + Composable | planned (Slice 1) |
| AudienceSwitcher | Monolith | planned (Slice 1) |
| LaneCard | Monolith + Composable | planned (Slice 1) |
| StatusBadge | Monolith | planned (Slice 2) |
| LiveIframe | Monolith | planned (Slice 5) |
| ContentExcerpt | Monolith | planned (Slice 3) |
