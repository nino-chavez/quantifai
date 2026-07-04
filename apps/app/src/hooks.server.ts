/**
 * Host-split routing (`handle`) — paired with `reroute` in src/hooks.ts.
 * `reroute` only changes which route tree matches; `handle` is where the
 * actual HTTP redirects happen, based on the REAL incoming hostname/path
 * (`event.url`, untouched by reroute).
 *
 * Behavior by host (architecture spec, this task):
 *  - app.quantifai.app, *.workers.dev: untouched — falls through to
 *    `resolve(event)`, same as before this task (ledger at "/", Access-gated
 *    at the Cloudflare Zero Trust layer in front of the Worker — nothing
 *    below duplicates that gate).
 *  - www.quantifai.app: redirect every request to the same path on the
 *    apex (308 — permanent, preserves method/body semantics for any future
 *    non-GET on this host, though today it only serves GET requests).
 *  - quantifai.app (apex): the public landing page and its supporting
 *    surface — "/" (remapped to /landing by reroute), the built static
 *    asset bundle, favicon/robots, and the two public API routes
 *    (public-stats, waitlist) — are served directly. Every OTHER path
 *    (e.g. /practice-numbers, /api/v1/ingest) redirects to the same path
 *    on app.quantifai.app, where it renders exactly as it does today
 *    (Access-gated). This is what keeps the private ledger/practice-numbers
 *    content from ever being reachable, unauthenticated, on the public apex.
 *
 * Rollback: removing the two new zone routes in wrangler.jsonc
 * (quantifai.app/*, www.quantifai.app/*) instantly restores the retired
 * Pages project on the apex/www — this file doesn't need to change for
 * that rollback to work, since the Worker simply stops receiving those
 * hosts' requests at all.
 */

import type { Handle } from '@sveltejs/kit';

const APEX = 'quantifai.app';
const WWW = 'www.quantifai.app';
const APP_HOST = 'app.quantifai.app';

const PUBLIC_PATHS = new Set(['/', '/landing', '/api/v1/public-stats', '/api/v1/waitlist']);

/** Static asset / well-known paths the public landing page itself needs — never gated, on any host. */
function isPublicAsset(pathname: string): boolean {
	return (
		pathname.startsWith('/_app/') ||
		pathname === '/favicon.svg' ||
		pathname === '/favicon.ico' ||
		pathname === '/robots.txt'
	);
}

function isPublicOnApex(pathname: string): boolean {
	return PUBLIC_PATHS.has(pathname) || isPublicAsset(pathname);
}

export const handle: Handle = async ({ event, resolve }) => {
	const { hostname } = event.url;

	if (hostname === WWW) {
		const target = new URL(event.url);
		target.hostname = APEX;
		return Response.redirect(target.toString(), 308);
	}

	if (hostname === APEX) {
		if (isPublicOnApex(event.url.pathname)) {
			return resolve(event);
		}
		const target = new URL(event.url);
		target.hostname = APP_HOST;
		return Response.redirect(target.toString(), 302);
	}

	// app.quantifai.app, *.workers.dev, local dev (127.0.0.1) — unchanged.
	return resolve(event);
};
