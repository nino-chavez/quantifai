import type { PageServerLoad } from './$types';
import { loadPracticeNumbers } from '$lib/server/practice-numbers';
import { getDb } from '$lib/server/d1';

export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDb(platform);
	const practiceNumbers = await loadPracticeNumbers(db, url.searchParams.get('window'));
	return { practiceNumbers };
};
