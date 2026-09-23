<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import TheaterRow from '$lib/components/TheaterRow.svelte'
  import type { TheaterSummary } from '$lib/theaters'

  // A phone's overview of where things are happening: one row per theater,
  // busiest first. Picking one closes the page onto that theater's stories.
  // Full screen rather than a sheet, because it is a place you go, not a
  // setting you change. Focus moves in on open and back on close; Tab stays in.
  let {
    open = $bindable(false),
    board,
    onpick,
  }: {
    open: boolean
    board: TheaterSummary[]
    onpick: (id: string) => void
  } = $props()

  let page = $state<HTMLElement | null>(null)
  let backBtn = $state<HTMLButtonElement | null>(null)
  let previouslyFocused: Element | null = null
  let wasOpen = false

  $effect(() => {
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement
      queueMicrotask(() => backBtn?.focus())
    } else if (!open && wasOpen) {
      const el = previouslyFocused as HTMLElement | null
      if (el?.isConnected && typeof el.focus === 'function') el.focus()
      previouslyFocused = null
    }
    wasOpen = open
  })

  function onKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); open = false; return }
    if (e.key !== 'Tab' || !page) return
    const controls = [...page.querySelectorAll<HTMLElement>('button')]
    const first = controls[0]
    const last = controls.at(-1)
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }

  function pick(id: string) {
    onpick(id)
    open = false
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    bind:this={page}
    data-theaters-page
    role="dialog"
    aria-modal="true"
    aria-labelledby="theaters-title"
    class="theaters fixed inset-0 z-50 flex flex-col bg-ink"
    style="padding-top: env(safe-area-inset-top, 0px)"
  >
    <div class="flex h-14 shrink-0 items-center px-2">
      <button bind:this={backBtn} type="button" class="action min-h-10 gap-1 px-2 text-[15px]" onclick={() => (open = false)}>
        <Icon name="chevron-left" size={20} />Stories
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="px-5 pt-2 pb-4">
        <p class="label mb-1.5">Theaters</p>
        <h2 id="theaters-title" class="font-serif text-[1.9rem] leading-tight text-fg">Where it’s happening</h2>
        <p class="mt-1.5 text-sm text-fg-2">Busiest first. Tap one to swipe only its stories.</p>
      </div>
      {#if board.length === 0}
        <p class="border-t border-line px-5 py-10 text-center text-sm text-fg-3">No stories are placed in a theater yet.</p>
      {:else}
        <ul class="border-t border-line" style="padding-bottom: env(safe-area-inset-bottom, 0px)">
          {#each board as summary (summary.theater.id)}
            <li><TheaterRow {summary} onpick={() => pick(summary.theater.id)} /></li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  @media (prefers-reduced-motion: no-preference) {
    .theaters { animation: theaters-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  }
  @keyframes theaters-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
</style>
