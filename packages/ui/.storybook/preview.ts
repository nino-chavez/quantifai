import type { Preview } from '@storybook/react-vite';

// Family tokens must load before the kit's own styles
import '@blueprint/design-tokens/css';
import '../src/styles.css';
import './tailwind.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'background',
      values: [
        { name: 'background', value: 'oklch(1 0 0)' },
        { name: 'contrast-100', value: 'oklch(0.96 0 0)' },
        { name: 'brand-bg',     value: 'oklch(0.97 0.03 215)' },
      ],
    },
    a11y: {
      element: '#storybook-root',
    },
  },
  globalTypes: {
    theme: {
      description: 'Theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark (preview only)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme ?? 'light';
      document.documentElement.dataset.theme = theme;
      return Story();
    },
  ],
};

export default preview;
