import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface LiveIframeProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Iframe source URL. */
  src: string;
  /** Accessible title for the iframe. */
  title: string;
  /** Display height. CSS value; default '600px'. */
  height?: string;
  /** Fallback content rendered when src is empty/null. */
  fallback?: ReactNode;
  /** Optional badge in the toolbar (status chip, tone hint, etc.). */
  badge?: ReactNode;
  /** Hide the toolbar entirely (rare; use for fully borderless embeds). */
  chromeless?: boolean;
}

/**
 * LiveIframe — a chrome-wrapped iframe with portal toolbar, "open in
 * new tab" affordance, and a graceful empty-state. The toolbar carries
 * the portal identity at the navigation layer; the iframe inside is
 * allowed to look surface-native (the commerce platform admin, merchant
 * storefront, etc.).
 *
 * Sandbox is intentionally permissive (allow-scripts + allow-same-origin
 * + allow-forms + allow-popups) so embedded surfaces can run normally.
 * Tighten per-instance if hosting untrusted content.
 */
export const LiveIframe = forwardRef<HTMLDivElement, LiveIframeProps>(
  function LiveIframe(
    { src, title, height = '600px', fallback, badge, chromeless = false, className, ...props },
    ref,
  ) {
    const isEmpty = !src || src.startsWith('#');

    return (
      <div
        ref={ref}
        data-slot="live-iframe"
        className={cn(
          'group/live-iframe overflow-hidden rounded-lg border border-contrast-200 bg-background',
          'shadow-sm',
          className,
        )}
        {...props}
      >
        {!chromeless && (
          <div
            data-slot="live-iframe-toolbar"
            className="flex items-center justify-between gap-2 border-b border-contrast-100 bg-contrast-100/40 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex shrink-0 gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-error/60" aria-hidden="true" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/60" aria-hidden="true" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/60" aria-hidden="true" />
              </span>
              <span className="truncate font-mono text-[11px] text-contrast-500">
                {isEmpty ? '(not yet wired)' : src}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {badge}
              {!isEmpty && (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium uppercase tracking-wide',
                    'text-contrast-500 transition-colors duration-fast ease-standard',
                    'hover:bg-background hover:text-foreground',
                    'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  )}
                  aria-label={`Open ${title} in new tab`}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  Open
                </a>
              )}
            </div>
          </div>
        )}

        <div className="relative bg-contrast-100/30" style={{ height }}>
          {isEmpty ? (
            fallback ?? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <RefreshCw
                  className="h-6 w-6 text-contrast-300"
                  aria-hidden="true"
                />
                <p className="font-mono text-xs uppercase tracking-wide text-contrast-400">
                  Iframe source not yet wired
                </p>
                <p className="max-w-sm text-sm text-contrast-500">
                  Set <code className="font-mono text-xs">src</code> on this LiveIframe to embed a live surface.
                </p>
              </div>
            )
          ) : (
            <iframe
              src={src}
              title={title}
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>
      </div>
    );
  },
);
