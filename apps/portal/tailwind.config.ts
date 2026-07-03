import type { Config } from 'tailwindcss';
import bcsPreset from '@blueprint/design-tokens/tailwind';

const config: Config = {
  presets: [bcsPreset as Config],
  content: [
    './src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
