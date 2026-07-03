import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBadge } from '../status-badge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Portal / StatusBadge',
  component: StatusBadge,
  parameters: { layout: 'centered' },
  argTypes: {
    status: {
      control: 'select',
      options: ['ready', 'partial', 'missing', 'not-applicable', 'planned'],
    },
    showIcon: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Ready: Story = { args: { status: 'ready' } };
export const Partial: Story = { args: { status: 'partial' } };
export const Missing: Story = { args: { status: 'missing' } };
export const NotApplicable: Story = { args: { status: 'not-applicable' } };
export const Planned: Story = { args: { status: 'planned' } };

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status="ready" />
      <StatusBadge status="partial" />
      <StatusBadge status="planned" />
      <StatusBadge status="missing" />
      <StatusBadge status="not-applicable" />
    </div>
  ),
};
