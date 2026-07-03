import type { PageServerLoad } from './$types';
import { loadLedgerData } from '$lib/server/ledger';
import { getDb } from '$lib/server/d1';

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform);
	const ledger = await loadLedgerData(db);
	return { ledger };
};
