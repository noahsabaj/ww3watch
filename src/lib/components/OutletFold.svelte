<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import type { Article } from '$lib/types'
  import type { OutletRow } from '$lib/story'

  // One outlet's row in a story's source list (src/lib/story.ts byOutlet): its
  // lead report, and the rest folded behind "N more from …" so one outlet
  // filing a dozen items can't bury the other newsrooms. Renders <li>s; the
  // caller owns the list and how each report looks.
  let {
    row,
    item,
    open = $bindable(false),
    class: toggleClass = '',
  }: {
    row: OutletRow
    item: Snippet<[Article]>
    open?: boolean
    /** Classes for the toggle's <li> (e.g. spanning a grid's columns). */
    class?: string
  } = $props()
</script>

{@render item(row.lead)}
{#if row.more.length > 0}
  <li class={toggleClass}>
    <button
      type="button"
      onclick={() => (open = !open)}
      aria-expanded={open}
      class="action min-h-9 gap-1 px-3 text-xs !text-fg-3 hover:!text-fg-2"
    >
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      {open ? `Fewer from ${row.lead.source_name}` : `${row.more.length} more from ${row.lead.source_name}`}
    </button>
  </li>
  {#if open}
    {#each row.more as article (article.id)}
      {@render item(article)}
    {/each}
  {/if}
{/if}
