import { useState, useEffect } from 'react';

export const AUDIENCES = ['executive', 'evaluator', 'engineering'] as const;
export type Audience = (typeof AUDIENCES)[number];

const STORAGE_KEY = 'blueprint-audience';
const CHANGE_EVENT = 'blueprint-audience-change';
const isAudience = (v: string | null): v is Audience =>
  v !== null && (AUDIENCES as readonly string[]).includes(v);

export interface UseAudiencePreferenceOptions {
  defaultValue?: Audience;
}

/**
 * Persisted audience preference. Mirrors a useState shape; the value is
 * hydrated from localStorage on mount and saved on every change.
 *
 * Cross-island sync: the portal renders the switcher (PortalNav) and its
 * consumers (HomeLanes etc.) as separate Astro islands. Each instance of
 * this hook listens to a `blueprint-audience-change` CustomEvent dispatched on
 * update, so toggling in one island re-renders the others. `storage` events
 * cover cross-tab sync but never fire on the same tab — the custom event
 * is what makes the homepage switcher feel live.
 */
export function useAudiencePreference(
  options: UseAudiencePreferenceOptions = {},
): [Audience, (next: Audience) => void] {
  const { defaultValue = 'evaluator' } = options;
  const [audience, setAudience] = useState<Audience>(defaultValue);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isAudience(stored)) {
        setAudience(stored);
      }
    } catch {
      // localStorage may be unavailable (private mode, SSR, etc.) — silently ignore
    }

    const onChange = (event: Event): void => {
      const detail = (event as CustomEvent<Audience>).detail;
      if (detail && isAudience(detail)) {
        setAudience(detail);
      }
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY && isAudience(event.newValue)) {
        setAudience(event.newValue);
      }
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const update = (next: Audience): void => {
    setAudience(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — preference simply won't persist this session
    }
    try {
      window.dispatchEvent(new CustomEvent<Audience>(CHANGE_EVENT, { detail: next }));
    } catch {
      // ignore — older runtimes without CustomEvent fall back to no cross-island sync
    }
  };

  return [audience, update];
}
