import * as NavBar from '@blueprint/ui/navbar';
import { AudienceSwitcher, useAudiencePreference } from '@blueprint/ui';

// Quantifai Next — the initiative's display name (brand label).
// Stamped from blueprint.yml `name` at stamp time; matches the token the
// Layout uses for <title> / footer so the brand reads consistently.
const PROJECT_NAME = 'Quantifai Next';

// The 7-verb IA spine. This is the canonical Blueprint information
// architecture and is always present regardless of which substrate sources
// a given initiative has wired — empty verbs render their own "not
// configured" state, they are never hidden from the nav.
const VERBS = [
  { href: '/discover', label: 'Discover' },
  { href: '/try',      label: 'Try' },
  { href: '/build',    label: 'Build' },
  { href: '/operate',  label: 'Operate' },
  { href: '/inspect',  label: 'Inspect' },
  { href: '/roadmap',  label: 'Roadmap' },
  { href: '/strategy', label: 'Strategy' },
] as const;

export interface PortalNavProps {
  currentPath: string;
}

/**
 * Whole nav as a React island. Owns audience preference state; renders
 * brand + verb switcher + audience chip group. The current verb is
 * highlighted from the SSR-passed currentPath.
 */
export function PortalNav({ currentPath }: PortalNavProps) {
  const [audience, setAudience] = useAudiencePreference();

  return (
    <NavBar.Root>
      <NavBar.Brand href="/">
        <img src="/project-logo.png" alt={PROJECT_NAME} className="h-5 w-5 object-contain" />
        <span>{PROJECT_NAME}</span>
      </NavBar.Brand>
      <NavBar.Switcher>
        {VERBS.map((verb) => (
          <NavBar.Item
            key={verb.href}
            href={verb.href}
            active={
              currentPath === verb.href || currentPath.startsWith(`${verb.href}/`)
            }
          >
            {verb.label}
          </NavBar.Item>
        ))}
      </NavBar.Switcher>
      <NavBar.Actions>
        <AudienceSwitcher value={audience} onChange={setAudience} />
      </NavBar.Actions>
    </NavBar.Root>
  );
}
