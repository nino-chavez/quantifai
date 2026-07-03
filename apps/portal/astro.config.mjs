import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    ssr: {
      // packages/ui consumes Radix peer deps; let Vite resolve them through the workspace
      noExternal: ['@blueprint/ui', '@blueprint/design-tokens'],
    },
  },
});
