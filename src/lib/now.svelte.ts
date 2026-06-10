// Shared reactive clock: time-derived labels (timeAgo, BREAKING, day
// separators) read clock.now so they re-render as time passes instead of
// freezing on quiet tabs. One app-lifetime interval; the visibilitychange
// refresh covers returning to a backgrounded tab whose timers were throttled.
//
// Svelte 5 module-state rule: export a const object and mutate a property
// (reassigning an exported $state binding is illegal). Read clock.now inside
// reactive expressions — don't destructure it.

export const clock = $state({ now: Date.now() })

if (typeof window !== 'undefined') {
  setInterval(() => {
    clock.now = Date.now()
  }, 30_000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clock.now = Date.now()
  })
}
