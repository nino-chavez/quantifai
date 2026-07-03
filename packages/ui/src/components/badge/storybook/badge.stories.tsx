import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../badge';

const meta: Meta<typeof Badge> = {
  title: 'Generic / Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  argTypes: {
    tone: {
      control: 'select',
      options: ['neutral', 'brand', 'success', 'error', 'warning', 'info'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { children: 'Draft', tone: 'neutral' } };
export const Brand: Story = { args: { children: 'New', tone: 'brand' } };
export const Success: Story = { args: { children: 'Ready', tone: 'success' } };
export const Error: Story = { args: { children: 'Failed', tone: 'error' } };
export const Warning: Story = { args: { children: 'Partial', tone: 'warning' } };
export const Info: Story = { args: { children: 'Planned', tone: 'info' } };

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="brand">Brand</Badge>
      <Badge tone="success">Success</Badge>
      <Badge tone="error">Error</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="info">Info</Badge>
    </div>
  ),
};
