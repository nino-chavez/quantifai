import type { PageServerLoad } from './$types';
import { loadLedgerData } from '$lib/server/ledger';

export const load: PageServerLoad = async () => {
	const ledger = await loadLedgerData();
	return { ledger };
};
