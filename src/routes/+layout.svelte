<script>
  import '../app.css'
  import Seo from '$lib/components/Seo.svelte'
  import { base } from '$app/paths'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

<Seo />
{@render children()}
<footer class="max-w-3xl mx-auto flex flex-wrap gap-4 px-4 pb-24 text-sm text-gray-400">
  <a href="{base}/about">About &amp; methodology</a><a href="{base}/privacy">Privacy</a><a href="{base}/feedback">Feedback &amp; corrections</a>
</footer>
