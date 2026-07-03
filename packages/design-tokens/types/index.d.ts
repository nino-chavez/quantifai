/**
 * @blueprint/design-tokens — TypeScript types
 *
 * Type-safe enums for token names. Use to constrain component prop values
 * to known tokens rather than free-string color/size inputs.
 */

export type BcsColorRole =
  | 'brand'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'background'
  | 'foreground';

export type BcsColorTone = 'DEFAULT' | 'background' | 'foreground';

export type BcsContrastStep = 100 | 200 | 300 | 400 | 500;

export type BcsFontFamily = 'heading' | 'body' | 'mono';

export type BcsFontSize =
  | 'xs' | 'sm' | 'base' | 'lg' | 'xl'
  | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | '8xl';

export type BcsRadius = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export type BcsShadow = 'sm' | 'md' | 'lg' | 'xl';

export type BcsDuration =
  | 'instant' | 'fast' | 'normal' | 'slow' | 'deliberate';

export type BcsEasing = 'standard' | 'decel' | 'accel' | 'spring';

export type BcsTheme = 'light' | 'dark';
