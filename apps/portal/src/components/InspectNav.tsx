import type { FeatureKey } from '@/lib/portal-config';

interface InspectNavProps {
  currentPath: string;
  /**
   * Computed feature flags from portalConfig(). Tabs whose backing substrate
   * is not wired for this initiative are hidden — never rendered as a broken
   * half-section. Optional so the component degrades to "show only always-on
   * tabs" if a caller forgets to pass it.
   */
  features?: Partial<Record<FeatureKey, boolean>>;
}

/**
 * A sub-nav tab. `feature` (when set) names the portalConfig feature flag that
 * must be true for the tab to appear; tabs with no `feature` are always shown.
 */
interface InspectTab {
  href: string;
  label: string;
  hint: string;
  feature?: FeatureKey;
}

const TABS: InspectTab[] = [
  { href: '/inspect',              label: 'Overview',     hint: 'methodology + axioms' },
  { href: '/inspect/gates',        label: 'Gate status',  hint: 'readiness gates',      feature: 'gates' },
  { href: '/inspect/attestations', label: 'Attestations', hint: 'manual sign-offs',     feature: 'attestations' },
  { href: '/inspect/dependencies', label: 'Dependencies', hint: 'top blockers',         feature: 'dependencies' },
  { href: '/inspect/coverage',     label: 'Coverage',     hint: 'derived-state audit',  feature: 'state' },
];

/**
 * Sub-nav for /inspect/* pages. Pill-bar of tabs with active-state highlight.
 * Active rule: an exact match wins (/inspect itself); for sub-pages, prefix match.
 * Tabs whose feature flag is off are filtered out.
 */
export function InspectNav({ currentPath, features }: InspectNavProps) {
  const visibleTabs = TABS.filter((tab) => !tab.feature || features?.[tab.feature]);

  return (
    <nav
      aria-label="Inspect sub-sections"
      className="mb-8 flex flex-wrap items-center gap-1 rounded-lg border border-contrast-200 bg-background p-1"
    >
      {visibleTabs.map((tab) => {
        const isActive =
          tab.href === '/inspect'
            ? currentPath === '/inspect' || currentPath === '/inspect/'
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
