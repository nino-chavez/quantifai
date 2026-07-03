import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '../card';
import { Button } from '../../button';
import { StatusBadge } from '../../status-badge';

const meta: Meta<typeof Card> = {
  title: 'Generic / Card',
  component: Card,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['flat', 'elevated', 'outline', 'ghost'],
    },
    padding: { control: 'select', options: ['none', 'sm', 'md', 'lg'] },
    interactive: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Flat: Story = {
  args: {
    variant: 'flat',
    title: 'API reference',
    description: 'REST + GraphQL — endpoints, scopes, webhooks, error shapes.',
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    title: 'Methodology',
    description: 'A composed surface with a title and supporting copy.',
  },
};

export const WithFooter: Story = {
  args: {
    title: 'Featured surface',
    description: 'A card with a footer action.',
    variant: 'elevated',
    footer: (
      <>
        <StatusBadge status="ready" />
        <Button variant="outline" size="sm">
          Launch live →
        </Button>
      </>
    ),
  },
};

export const Grid: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card variant="elevated" title="ADRs" description="58 ratified decisions.">
        <StatusBadge status="ready" />
      </Card>
      <Card variant="elevated" title="API" description="REST + GraphQL.">
        <StatusBadge status="partial" />
      </Card>
      <Card variant="elevated" title="Surface C" description="A third example card.">
        <StatusBadge status="ready" />
      </Card>
    </div>
  ),
};
