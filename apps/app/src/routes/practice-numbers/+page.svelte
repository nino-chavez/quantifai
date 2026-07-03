<script lang="ts">
	import PracticeNumbersView from '$lib/components/PracticeNumbersView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>QuantifAI — practice numbers</title>
</svelte:head>

<PracticeNumbersView data={data.practiceNumbers} />
