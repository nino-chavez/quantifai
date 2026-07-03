import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../button';

const meta: Meta<typeof Button> = {
  title: 'Generic / Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'destructive'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Add to plan', variant: 'primary' },
};

export const Secondary: Story = {
  args: { children: 'View details', variant: 'secondary' },
};

export const Outline: Story = {
  args: { children: 'Cancel', variant: 'outline' },
};

export const Ghost: Story = {
  args: { children: 'Skip', variant: 'ghost' },
};

export const Destructive: Story = {
  args: { children: 'Delete subscription', variant: 'destructive' },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Plus className="h-4 w-4" /> New plan
      </>
    ),
    variant: 'primary',
  },
};

export const IconOnly: Story = {
  args: {
    children: <Trash2 className="h-4 w-4" />,
    variant: 'ghost',
    size: 'icon',
    'aria-label': 'Delete',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">
        Large
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  ),
};
