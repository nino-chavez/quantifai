# @blueprint/design-tokens

Canonical design tokens for the quantifai-next family — OKLCH color, type scale, spacing, motion. Framework-agnostic; consumed by React (`packages/ui`), Svelte (`apps/storefront-svelte`), vanilla HTML (`apps/demos`), and any future surface that joins the family.

## Why OKLCH

OKLCH is perceptually uniform on the lightness axis — moving from L=0.55 to L=0.62 looks like the same step regardless of hue. HSL doesn't have that property. The payoff is that we can derive backgrounds and foregrounds programmatically from a single brand triplet:

```css
.brand-tint {
  /* Derives a light-tinted background from the brand source — re-themes for free */
  background: oklch(from var(--quan-brand-lch) 0.97 0.03 h);
}
```

Change `--quan-brand-lch` once and every derived shade re-themes automatically. The same idiom is used in commercial storefront kits; we intentionally rhyme.

## Usage

### From a Tailwind app

```js
// tailwind.config.js
import bcsPreset from '@blueprint/design-tokens/tailwind';

export default {
  presets: [bcsPreset],
  content: [
    './src/**/*.{js,ts,jsx,tsx,svelte}',
    './node_modules/@blueprint/ui/dist/**/*.{js,mjs}',
  ],
};
```

```ts
// Entry file (e.g., main.tsx, app.svelte.ts, layout.astro)
import '@blueprint/design-tokens/css';
```

Then use Tailwind classes:

```tsx
<div className="bg-background text-foreground">
  <h1 className="font-heading text-4xl">Headline</h1>
  <p className="font-body text-contrast-400">Supporting copy</p>
  <button className="bg-brand text-brand-foreground rounded-md">Action</button>
</div>
```

### From a non-Tailwind surface (vanilla HTML, Svelte without Tailwind)

Import the CSS variables and use them directly:

```css
@import '@blueprint/design-tokens/css';

.headline {
  color: oklch(var(--quan-foreground-lch));
  font-family: var(--quan-font-heading);
  font-size: 2.5rem;
}
```

### From TypeScript (for token-typed component props)

```ts
import type { BcsColorRole, BcsFontSize } from '@blueprint/design-tokens/types';

interface BadgeProps {
  tone?: BcsColorRole;   // 'brand' | 'success' | 'error' | ...
  size?: BcsFontSize;    // 'xs' | 'sm' | 'base' | ...
}
```

## Namespace

All variables are prefixed `--quan-*` so they never collide with merchant-supplied tokens on the storefront, the platform design system tokens in the admin marketplace shell, or BC platform tokens elsewhere.

## Files

| Path | Purpose |
|------|---------|
| `tokens.json` | Canonical source of truth (used as input for future codegen, currently a documentation artifact) |
| `css/variables.css` | CSS variable definitions (the live token surface every consumer reads) |
| `tailwind/preset.js` | Tailwind preset extending color/font/radius/shadow/transition with token-bound utilities |
| `types/index.d.ts` | TypeScript types for token names |

## Theme switching

Three modes work out of the box:

| Trigger | What happens |
|---------|--------------|
| Default | Light mode |
| `prefers-color-scheme: dark` | Dark mode (OS-driven) |
| `<html data-theme="light">` or `data-theme="dark"` | Forced mode (overrides OS) |

The portal's audience switcher and the prototype's display controls hook into `data-theme` to give consumers explicit control.
