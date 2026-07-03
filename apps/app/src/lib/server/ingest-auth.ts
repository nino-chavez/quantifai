/**
 * Ingest Bearer-key auth. ADR-0005: the ingest endpoint is exempted from
 * Cloudflare Access (importers are non-interactive, can't complete an
 * Access login) and gated by this Bearer key instead — same key model the
 * retired quantifai-platform proved (SHA-256 at rest).
 *
 * The Worker secret (`INGEST_API_KEY_HASH`, set via `wrangler secret put`)
 * holds the hex SHA-256 digest of the real key, never the key itself — even
 * a full `wrangler secret list`/dashboard leak doesn't hand over a usable
 * credential. Comparison is constant-time (fixed-length hex digests), per
 * the Workers best-practices rule against direct string comparison of
 * secrets (timing side-channel).
 */

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Constant-time compare for two same-shape hex digests (fixed-length, so no length-based branch to worry about — unequal lengths simply can't happen for two SHA-256 hex outputs, but we still don't short-circuit the loop on content). */
function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export async function verifyIngestKey(
	request: Request,
	expectedHash: string | undefined
): Promise<boolean> {
	if (!expectedHash) return false; // secret not configured — fail closed

	const authHeader = request.headers.get('authorization') ?? '';
	if (!authHeader.startsWith('Bearer ')) return false;

	const presented = authHeader.slice('Bearer '.length).trim();
	if (!presented) return false;

	const presentedHash = await sha256Hex(presented);
	return timingSafeEqualHex(presentedHash, expectedHash.trim().toLowerCase());
}
