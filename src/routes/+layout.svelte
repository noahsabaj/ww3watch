<script>
  import '../app.css'
  import Seo from '$lib/components/Seo.svelte'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

<Seo />
<!-- Pages bring their own chrome: the feed its app shell, everything else
     PageShell (src/lib/components/PageShell.svelte), which owns the footer. -->
{@render children()}
