import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sparkles } from 'lucide-react';
import { Alert } from '../alert';
import * as AlertPrimitive from '../primitives';
import { Badge } from '../../badge';
import { Button } from '../../button';

const meta: Meta<typeof Alert> = {
  title: 'Generic / Alert',
  component: Alert,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'info', 'success', 'warning', 'error'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Alert>;

export const Info: Story = {
  args: {
    variant: 'info',
    title: 'Heads up',
    message: 'Synthesis-cited PR commit subjects must include `closes #PROPOSAL`.',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    title: 'Live derive data wired',
    message: 'Card descriptions now read from state-derive at build time.',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    title: 'Authored content lands in Slice 3',
    message: 'The operate lane has the lowest authored content today.',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    title: 'Charge failed',
    message: 'Dunning will retry in 3 days. Manual review available on the subscription.',
  },
};

export const Composable: Story = {
  render: () => (
    <AlertPrimitive.Root variant="warning">
      <AlertPrimitive.Icon>
        <Sparkles />
      </AlertPrimitive.Icon>
      <div className="flex-1">
        <header className="flex items-center justify-between gap-3">
          <AlertPrimitive.Title>Composable usage</AlertPrimitive.Title>
          <Badge tone="warning">Action required</Badge>
        </header>
        <AlertPrimitive.Body>
          Primitives let you compose custom layouts — header bars, footer actions, mixed badges.
        </AlertPrimitive.Body>
        <footer className="mt-3 flex gap-2">
          <Button variant="outline" size="sm">
            Dismiss
          </Button>
          <Button variant="primary" size="sm">
            Fix it
          </Button>
        </footer>
      </div>
    </AlertPrimitive.Root>
  ),
};
