import type { Meta, StoryObj } from '@storybook/react-vite';
import { LaneCard } from '../lane-card';
import { StatusBadge } from '../../status-badge';

const meta: Meta<typeof LaneCard> = {
  title: 'Portal / LaneCard',
  component: LaneCard,
  parameters: { layout: 'padded' },
  argTypes: {
    verb: {
      control: 'select',
      options: ['discover', 'try', 'build', 'operate', 'inspect', 'roadmap'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof LaneCard>;

export const Discover: Story = {
  args: {
    verb: 'discover',
    description:
      'North star, value proposition, the bet we are placing. Strategy, BRD, PRD, ARCHITECTURE distilled.',
    meta: <StatusBadge status="partial" />,
  },
};

export const Try: Story = {
  args: {
    verb: 'try',
    description:
      'See it work, live. Interactive demo surfaces and guided scenarios.',
    meta: <StatusBadge status="partial" />,
  },
};

export const Build: Story = {
  args: {
    verb: 'build',
    description: 'Integrate it. API, ADRs, SDKs, the storefront-kit-inspired component library.',
    meta: <StatusBadge status="ready" />,
  },
};

export const Operate: Story = {
  args: {
    verb: 'operate',
    description: 'Use it day-to-day. Merchant admin guide, subscriber portal, dunning playbook.',
    meta: <StatusBadge status="planned" />,
  },
};

export const Inspect: Story = {
  args: {
    verb: 'inspect',
    description: 'Methodology, Hive substrate, ADR-derived decisions, derived state authority.',
    meta: <StatusBadge status="ready" />,
  },
};

export const Roadmap: Story = {
  args: {
    verb: 'roadmap',
    description: 'Where it is going. Ready queue, epic progress, swimlane visualization.',
    meta: <StatusBadge status="ready" />,
  },
};

export const SixVerbGrid: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <LaneCard verb="discover" description="North star, value proposition, the bet." meta={<StatusBadge status="partial" />} />
      <LaneCard verb="try" description="See it work, live. Storefront, admin, prototype." meta={<StatusBadge status="partial" />} />
      <LaneCard verb="build" description="Integrate it. API, ADRs, SDKs, components." meta={<StatusBadge status="ready" />} />
      <LaneCard verb="operate" description="Use it day-to-day. Merchant + subscriber guides." meta={<StatusBadge status="planned" />} />
      <LaneCard verb="inspect" description="Look under the hood. Methodology, substrate, ADRs." meta={<StatusBadge status="ready" />} />
      <LaneCard verb="roadmap" description="Where it's going. Ready queue, epics, swimlanes." meta={<StatusBadge status="ready" />} />
    </div>
  ),
};
