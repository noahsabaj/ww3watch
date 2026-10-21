<script lang="ts">
  import type { createStoryPhoto } from '#lib/story-photo.svelte.js'
  import { photoSrc, resizable } from '#lib/photo-src.js'

  // A newsroom photograph from createStoryPhoto(): resized through wsrv.nl
  // (src/lib/photo-src.ts), the original hotlinked without a referrer if that
  // fails (several publishers refuse one), and handed back to the factory when
  // the original fails too or is too small, so the surface falls back to its colour.
  let { photo, class: cls = '', lazy = false, priority = false, drawnPx }: {
    photo: ReturnType<typeof createStoryPhoto>
    class?: string
    lazy?: boolean
    /** The largest thing on the first screen: ask for it before the rest. */
    priority?: boolean
    /** How wide the photo is drawn, in CSS pixels. Default: the viewport. */
    drawnPx?: number
  } = $props()

  // The URL whose resized copy failed: show its original instead.
  let directFor = $state<string | null>(null)
  const url = $derived(photo.shown?.url ?? null)
  const direct = $derived(url === null || directFor === url || !resizable(url))
  const src = $derived(url && (direct ? url : photoSrc(url, photo.minWidth, drawnPx ?? window.innerWidth, window.devicePixelRatio || 1)))

  function onerror() {
    if (!direct && url) directFor = url
    else photo.fail()
  }
</script>

{#if photo.shown && src}
  <img
    {src}
    alt=""
    class={cls}
    referrerpolicy="no-referrer"
    decoding="async"
    loading={lazy ? 'lazy' : undefined}
    fetchpriority={priority ? 'high' : undefined}
    {onerror}
    onload={photo.loaded}
  />
{/if}
