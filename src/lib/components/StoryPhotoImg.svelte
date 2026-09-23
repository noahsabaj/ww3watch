<script lang="ts">
  import type { createStoryPhoto } from '$lib/story-photo.svelte'

  // A newsroom photograph from createStoryPhoto(): hotlinked without a
  // referrer (several publishers refuse one), and handed back to the factory
  // when it fails or is too small, so the surface falls back to its colour.
  let { photo, class: cls = '', lazy = false }: {
    photo: ReturnType<typeof createStoryPhoto>
    class?: string
    lazy?: boolean
  } = $props()
</script>

{#if photo.shown}
  <img
    src={photo.shown.url}
    alt=""
    class={cls}
    referrerpolicy="no-referrer"
    decoding="async"
    loading={lazy ? 'lazy' : undefined}
    onerror={photo.fail}
    onload={photo.loaded}
  />
{/if}
