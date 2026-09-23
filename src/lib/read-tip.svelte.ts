// Signal's "Tap the headline to read it and every other newsroom's version."
// teaches one thing once: after the reader has opened a story that way, the
// tip goes from every story and stays gone, like the swipe cue.
const KEY = 'ww3-read-tip-seen'

// Hidden until storage says otherwise, so a returning reader never sees it flash.
export const readTip = $state({ seen: true })

let loaded = false
/** Call from a component (client only) before reading `readTip.seen`. */
export function loadReadTip() {
  if (loaded) return
  loaded = true
  try { readTip.seen = localStorage.getItem(KEY) === '1' } catch { readTip.seen = false }
}

export function markReadTipSeen() {
  if (readTip.seen) return
  readTip.seen = true
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}
