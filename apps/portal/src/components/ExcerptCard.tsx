import type { ReactNode } from 'react';
import { Card } from '@blueprint/ui';
import type { Excerpt } from '@/lib/content';

export interface ExcerptCardProps {
  title: ReactNode;
  excerpt: Excerpt | null;
  /** Optional badge slot (status, tag, etc.) shown in the footer. */
  badge?: ReactNode;
  /**
   * Repo URL prefix for source links (e.g. `${repoUrl}/blob/main`). Derived from
   * portalConfig().repoUrl by the caller. When omitted (Tier-0, no repoUrl
   * configured), the source link is hidden rather than rendered as a broken anchor.
   */
  repoPrefix?: string;
}

/**
 * Card that surfaces a markdown excerpt with a "Read full" link to the
 * canonical source. When the excerpt isn't found, the card renders a
 * 'planned' placeholder pointing at the intended source.
 */
export function ExcerptCard({ title, excerpt, badge, repoPrefix }: ExcerptCardProps) {
  if (!excerpt) {
    return (
      <Card variant="outline" title={title} description="Excerpt source not yet authored.">
        {badge}
      </Card>
    );
  }

  const sourceUrl = repoPrefix ? `${repoPrefix}/${excerpt.source}#${excerpt.anchor}` : null;

  return (
    <Card variant="elevated" title={title}>
      <p className="text-sm leading-relaxed text-contrast-500 whitespace-pre-wrap">
        {excerpt.body}
      </p>
      <div className="mt-3 flex items-center justify-between">
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-brand transition-colors duration-fast ease-standard hover:underline"
          >
            {excerpt.source} <span aria-hidden>→</span>
          </a>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wide text-contrast-400">
            {excerpt.source}
          </span>
        )}
        {badge}
      </div>
    </Card>
  );
}
