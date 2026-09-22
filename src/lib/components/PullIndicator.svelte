<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { PULL_HOLD, PULL_LINE, type PullRefresh } from '$lib/pull-refresh.svelte'

  // Sits behind the list and is uncovered as it is pulled down: turns to the
  // accent at the line, spins while fetching.
  let { state }: { state: PullRefresh } = $props()
  const armed = $derived(state.refreshing || state.pull >= PULL_LINE)
</script>

<div
  data-pull-indicator
  aria-hidden="true"
  class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center text-fg-2"
  style="height: {PULL_HOLD}px; opacity: {state.refreshing ? 1 : Math.min(1, state.pull / PULL_LINE)}"
>
  <span
    class="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel {state.refreshing ? 'animate-spin' : ''} {armed ? 'text-accent' : ''}"
    style={state.refreshing ? undefined : `transform: rotate(${(state.pull / PULL_LINE) * 270}deg)`}
  >
    <Icon name="refresh" size={15} stroke={2} />
  </span>
</div>
