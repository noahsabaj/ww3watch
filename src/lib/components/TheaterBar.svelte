<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Theater } from '$lib/theaters'

  // Says which theater the feed is narrowed to and how to leave it — the same
  // shape as search: what you're looking at, and one way back to everything.
  let { theater, count, onclear }: { theater: Theater; count: number; onclear: () => void } = $props()
</script>

<div data-theater-bar class="flex shrink-0 items-center gap-3 border-b border-line bg-ink px-4 py-2">
  <button
    type="button"
    onclick={onclear}
    aria-label="Stop showing only {theater.label}"
    class="inline-flex min-h-8 items-center gap-2 rounded-full border border-accent/35 bg-accent/15 px-3 text-sm text-accent"
  >
    {theater.label}<Icon name="close" size={13} stroke={2.2} />
  </button>
  <span class="text-xs text-fg-3 tabular-nums">{count} {count === 1 ? 'story' : 'stories'}</span>
  <button type="button" onclick={onclear} class="action ml-auto min-h-8 text-sm">All stories</button>
</div>
