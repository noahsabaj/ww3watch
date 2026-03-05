<script>
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
