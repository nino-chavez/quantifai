/**
 * Hostname consolidation (`handle`) — single human hostname, path routes.
 *
 * quantifai.app is the only human hostname: "/" is the public landing,
 * "/ledger" and "/practice-numbers" are the operator surfaces (gated at the
 * edge by path-scoped Cloudflare Access applications — `quantifai.app/ledger*`
 * and `quantifai.app/practice-numbers*` on the `quantifai-app — ledger` Zero
 * Trust app; nothing in this Worker duplicates that gate), and `/api/v1/*`
 * carries its own in-app auth (Bearer ingest key / cron secret / Turnstile)
 * under an Access bypass. There is no host-based route split anymore — the
 * same path serves the same content on every host, so this hook only does
 * hostname canonicalization:
 *
 *  - www.quantifai.app: 308 to the identical path on the apex.
 *  - app.quantifai.app: DEPRECATED (the "app.app" subdomain stutter) — 301
 *    to the same path on quantifai.app, with "/" mapping to "/ledger" since
 *    that host's root was the ledger before the consolidation. Its DNS
 *    records + zone route stay only to serve this redirect.
 *  - quantifai.app, *.workers.dev, local dev: fall through to resolve().
 *    workers.dev stays the importer/API host (see README — the zone WAF
 *    403s POSTs on quantifai.app even from a real browser with a valid
 *    Turnstile token, so programmatic and form POSTs go to workers.dev).
 *
 * Rollback of the whole public-apex takeover: remove the quantifai.app/* and
 * www.quantifai.app/* zone routes in wrangler.jsonc — the retired Pages
 * project (quantifai-landing.pages.dev) is still CNAMEd and resumes serving.
 */

import type { Handle } from '@sveltejs/kit';

const APEX = 'quantifai.app';
const WWW = 'www.quantifai.app';
const DEPRECATED_APP_HOST = 'app.quantifai.app';

export const handle: Handle = async ({ event, resolve }) => {
	const { hostname } = event.url;

	if (hostname === WWW) {
		const target = new URL(event.url);
		target.hostname = APEX;
		return Response.redirect(target.toString(), 308);
	}

	if (hostname === DEPRECATED_APP_HOST) {
		const target = new URL(event.url);
		target.hostname = APEX;
		if (target.pathname === '/') target.pathname = '/ledger';
		return Response.redirect(target.toString(), 301);
	}

	return resolve(event);
};
