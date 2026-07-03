import type { FeatureKey } from '@/lib/portal-config';

interface TryNavProps {
  currentPath: string;
  /**
   * Computed feature flags from portalConfig(). The Scenarios tab is hidden
   * when no scenarios source is wired for this initiative.
   */
  features?: Partial<Record<FeatureKey, boolean>>;
}

interface TryTab {
  href: string;
  label: string;
  hint: string;
  feature?: FeatureKey;
}

const TABS: TryTab[] = [
  { href: '/try',           label: 'Live surfaces', hint: 'iframed surfaces' },
  { href: '/try/scenarios', label: 'Scenarios',     hint: 'scripted demos',  feature: 'scenarios' },
];

export function TryNav({ currentPath, features }: TryNavProps) {
  const visibleTabs = TABS.filter((tab) => !tab.feature || features?.[tab.feature]);

  return (
    <nav
      aria-label="Try sub-sections"
      className="mb-8 flex flex-wrap items-center gap-1 rounded-lg border border-contrast-200 bg-background p-1"
    >
      {visibleTabs.map((tab) => {
        const isActive =
          tab.href === '/try'
            ? currentPath === '/try' || currentPath === '/try/'
            : currentPath.startsWith(tab.href);
        return (
          <a
            key={tab.href}
            href={tab.href}
            data-active={isActive ? 'true' : 'false'}
            className="group inline-flex flex-col items-start rounded-md px-3 py-1.5 text-sm transition-colors duration-fast ease-standard hover:bg-contrast-100 data-[active=true]:bg-contrast-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span className="font-medium text-foreground group-data-[active=true]:text-brand">
              {tab.label}
            </span>
            <span className="font-mono text-[10px] text-contrast-400">{tab.hint}</span>
          </a>
        );
      })}
    </nav>
  );
}
