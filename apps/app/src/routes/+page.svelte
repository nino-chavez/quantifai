<script lang="ts">
	import LandingView from '$lib/components/LandingView.svelte';
	import type { PublicStats } from '$lib/server/public-stats';

	let { data }: { data: { stats: PublicStats; turnstileSiteKey: string } } = $props();
</script>

<svelte:head>
	<title>QuantifAI — what your practice cost, and what it produced</title>
	<meta
		name="description"
		content="QuantifAI prices AI-assisted work at the unit of work and pairs every dollar with the commits it produced."
	/>
</svelte:head>

<LandingView stats={data.stats} turnstileSiteKey={data.turnstileSiteKey} />
