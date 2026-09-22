<script lang="ts">
  import { page } from '$app/state'
  import { base } from '$app/paths'
  import PageShell from '$lib/components/PageShell.svelte'

  const missing = $derived(page.status === 404)
</script>

<PageShell title={missing ? 'Nothing here' : 'Something went wrong'}>
  <p class="page-prose">
    {missing
      ? 'This page doesn’t exist, or it moved. The reporting is all on the feed.'
      : 'The page failed to load. Try again in a moment; the feed itself may still be working.'}
  </p>
  <a href="{base}/" class="btn mt-8">Go to the latest reporting</a>
</PageShell>
