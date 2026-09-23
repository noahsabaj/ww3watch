<script lang="ts">
  import type { TheaterSummary } from '$lib/theaters'
  import { headlineText } from '$lib/utils'
  import { createStoryPhoto } from '$lib/story-photo.svelte'

  // One theater on the Theaters page: its name and how busy it is, the story
  // leading it, and that story's photograph beside the words, never under them.
  let { summary, onpick }: { summary: TheaterSummary; onpick: () => void } = $props()

  const photo = createStoryPhoto(() => summary.lead, 96)
  // Summed up in the reader's likeliest language when any outlet wrote it so.
  const headline = $derived(summary.lead.articles.find((a) => a.source_lang === 'en') ?? summary.lead.representative)
  const count = $derived(summary.today > 0 ? `${summary.today} today` : `${summary.stories.length} ${summary.stories.length === 1 ? 'story' : 'stories'}`)
</script>

<button
  type="button"
  data-theater={summary.theater.id}
  onclick={onpick}
  class="flex w-full items-start gap-3.5 border-b border-line px-5 py-3.5 text-start transition-colors hover:bg-white/[0.03]"
>
  <span class="w-[3px] self-stretch rounded-full" style="background: {summary.theater.color}" aria-hidden="true"></span>
  <span class="min-w-0 flex-1">
    <span class="flex items-baseline gap-2">
      <span class="font-serif text-[1.2rem] leading-snug text-fg">{summary.theater.label}</span>
      <span class="ml-auto shrink-0 text-xs text-fg-3 tabular-nums">{count}</span>
    </span>
    <span dir="auto" class="mt-1 block text-sm leading-snug text-fg-2 line-clamp-2">{headlineText(headline.title)}</span>
    {#if summary.major > 0}
      <span class="mt-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-amber-400">{summary.major} major</span>
    {/if}
  </span>
  {#if photo.shown}
    <img
      src={photo.shown.url}
      alt=""
      class="h-16 w-16 shrink-0 rounded-lg object-cover"
      referrerpolicy="no-referrer"
      decoding="async"
      loading="lazy"
      onerror={photo.fail}
      onload={photo.loaded}
    />
  {/if}
</button>
