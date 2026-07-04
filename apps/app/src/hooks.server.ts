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
 *  - app.quantifai.app: REMOVED entirely (2026-07-04, "no current users") —
 *    no route, no DNS records, no redirect. It briefly existed during the
 *    2026-07-03 consolidation; nothing references it.
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

export const handle: Handle = async ({ event, resolve }) => {
	const { hostname } = event.url;

	if (hostname === WWW) {
		const target = new URL(event.url);
		target.hostname = APEX;
		return Response.redirect(target.toString(), 308);
	}

	return resolve(event);
};
