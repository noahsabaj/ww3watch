<script>
  import '../app.css'
  import Seo from '#lib/components/Seo.svelte'
  import { onMount } from 'svelte'
  import { dev } from '$app/env'
  import { resolve } from '$app/paths'

  let { children } = $props()

  // The service worker (sw.js, written over the finished build by
  // vite.config.ts). A new version takes over the moment it installs, and the
  // page reloads onto it. None in dev, where there is no sw.js.
  onMount(async () => {
    if (dev || !('serviceWorker' in navigator)) return
    const { Workbox } = await import('workbox-window')
    const wb = new Workbox(`${resolve('/')}sw.js`, { scope: resolve('/') })
    wb.addEventListener('activated', (event) => {
      if (event.isUpdate || event.isExternal) location.reload()
    })
    // Private windows and some in-app browsers refuse service workers; the site works without one.
    wb.register({ immediate: true }).catch(() => {})
  })
</script>

<Seo />
<!-- Pages bring their own chrome: the feed its app shell, everything else
     PageShell (src/lib/components/PageShell.svelte), which owns the footer. -->
{@render children()}
