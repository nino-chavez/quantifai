<script lang="ts">
	import LedgerView from '$lib/components/LedgerView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>QuantifAI — practice ledger</title>
</svelte:head>

<LedgerView data={data.ledger} />
