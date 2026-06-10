<script>
  import '../app.css'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

{@render children()}
