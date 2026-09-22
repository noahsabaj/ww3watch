// Pull to refresh, as in every feed app: at the top of a scrolling list, drag
// down and let go past the line to fetch the newest. Touch only, so it works
// on phones, iPads and touchscreen laptops and never gets in a mouse's way.
//
// The first downward move at the top is claimed before the browser starts its
// own rubber band (after that, touchmove can no longer be cancelled), and the
// list follows the finger at half speed. Pair with PullIndicator.svelte, and
// translate the list by `pull`.

export const PULL_LINE = 64
export const PULL_HOLD = 56
const PULL_MAX = 110

export function createPullRefresh(
  element: () => HTMLElement | null,
  onrefresh: () => (() => Promise<unknown>) | undefined,
  ondone?: () => void,
) {
  let pull = $state(0)
  let dragging = $state(false)
  let refreshing = $state(false)

  $effect(() => {
    const el = element()
    const refresh = onrefresh()
    if (!el || !refresh) return
    let startX = 0, startY = 0
    let tracking = false
    function start(e: TouchEvent) {
      tracking = !refreshing && e.touches.length === 1 && el!.scrollTop <= 0
      if (!tracking) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
    function move(e: TouchEvent) {
      if (!tracking) return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX
      if (!dragging) {
        if (dy === 0) return
        if (dy < 0 || Math.abs(dx) > dy || el!.scrollTop > 0) { tracking = false; return }
        dragging = true
      }
      if (e.cancelable) e.preventDefault()
      pull = Math.min(PULL_MAX, Math.max(0, dy) / 2)
    }
    async function end() {
      tracking = false
      if (!dragging) return
      dragging = false
      if (pull < PULL_LINE) { pull = 0; return }
      refreshing = true
      pull = PULL_HOLD
      try { await refresh!() } finally {
        refreshing = false
        pull = 0
      }
      ondone?.()
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  })

  return {
    get pull() { return pull },
    get refreshing() { return refreshing },
    /** Inline style for the list: follows the finger, springs back on release. */
    get style() {
      return `transform: ${pull ? `translateY(${pull}px)` : 'none'}; transition: ${dragging ? 'none' : 'transform 0.25s ease'}`
    },
  }
}

export type PullRefresh = ReturnType<typeof createPullRefresh>
