// Teaching tips: quiet one-line cues for a gesture that isn't obvious, each
// retired for good once this reader has done the thing it teaches. A tip that
// stays up after it has been learned only gets in the way.
//
// To add one: give it a key in saved.ts, name it here, show it while
// `tips.shown(id)`, and call `tips.done(id)` where the reader does the thing.
import { load, save, type SavedKey } from './saved'

const TIPS = {
  /** "Swipe up for the next story" on Signal's first story: done on the first swipe. */
  swipe: 'tipSwipe',
  /** "Tap the headline to read it and every other newsroom's version": done on opening a covered story. */
  'read-story': 'tipReadStory',
} as const satisfies Record<string, SavedKey>
export type TipId = keyof typeof TIPS
const IDS = Object.keys(TIPS) as TipId[]

// Everything counts as learned until storage says otherwise, so a returning
// reader never sees a tip flash on and off.
const learned = $state(Object.fromEntries(IDS.map((id) => [id, true])) as Record<TipId, boolean>)
let loaded = false

export const tips = {
  /** Read what this reader has learned. Call from an $effect or onMount (client only). */
  load() {
    if (loaded) return
    loaded = true
    for (const id of IDS) learned[id] = load(TIPS[id]) === '1'
  },
  /** The tip should still be on screen. */
  shown(id: TipId): boolean {
    return !learned[id]
  },
  /** The reader has done what the tip teaches: retire it everywhere, for good. */
  done(id: TipId) {
    if (learned[id]) return
    learned[id] = true
    save(TIPS[id], '1')
  },
}
