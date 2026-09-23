<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Snippet } from 'svelte'
  import { modal } from '$lib/modal'

  // One surface for everything that opens over the page (the site menu):
  // a bottom sheet on a phone, a panel under the header's right edge on a
  // wide screen. Keyboard and focus behaviour is src/lib/modal.ts; a tap
  // outside also closes it.
  let {
    open = $bindable(false),
    title,
    id,
    children,
    footer,
  }: {
    open: boolean
    title: string
    id?: string
    children: Snippet
    footer?: Snippet
  } = $props()

</script>

{#if open}
  <div class="sheet-backdrop fixed inset-0 z-[60] bg-black/60 min-[820px]:bg-transparent" onclick={() => (open = false)} role="presentation"></div>
  <div
    {id}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    {@attach modal({ onclose: () => (open = false) })}
    class="sheet fixed z-[70] flex flex-col overflow-hidden border-line bg-panel shadow-2xl shadow-black/60 outline-none
      inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[1.75rem] border-t
      min-[820px]:inset-x-auto min-[820px]:bottom-auto min-[820px]:right-4 min-[820px]:top-[4.25rem] min-[820px]:w-[25rem] min-[820px]:max-h-[calc(100dvh-5.5rem)] min-[820px]:rounded-2xl min-[820px]:border"
  >
    <div class="flex justify-center pt-2.5 min-[820px]:hidden" aria-hidden="true">
      <div class="h-1 w-10 rounded-full bg-white/15"></div>
    </div>
    <div class="flex items-center justify-between px-5 pt-2 pb-1 min-[820px]:pt-3">
      <h2 class="font-serif text-xl text-fg">{title}</h2>
      <button type="button" class="icon-btn -mr-2" aria-label="Close" onclick={() => (open = false)}>
        <Icon name="close" size={18} stroke={2} />
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
      {@render children()}
    </div>
    {#if footer}
      <div class="border-t border-line px-5 py-3" style="padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px))">
        {@render footer()}
      </div>
    {:else}
      <div class="min-[820px]:hidden" style="height: env(safe-area-inset-bottom, 0px)"></div>
    {/if}
  </div>
{/if}

<style>
  @media (prefers-reduced-motion: no-preference) {
    .sheet { animation: sheet-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .sheet-backdrop { animation: fade-in 180ms ease-out; }
    @media (min-width: 820px) {
      .sheet { animation: panel-in 160ms ease-out; }
    }
  }
  @keyframes sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes panel-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
</style>
