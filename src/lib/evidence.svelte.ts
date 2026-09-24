// Sensor evidence for the stories on screen, fetched in batches as stories
// render and kept per story for a few minutes: a satellite pass can add a
// fire to a story hours after it was first read.
import { SvelteMap } from 'svelte/reactivity'
import { browser } from '$app/environment'
import { supabase } from './supabase'
import type { StoryEvidence } from './evidence-text'

const KEEP_MS = 10 * 60_000
const byStory = new SvelteMap<string, StoryEvidence[]>()
const askedAt = new Map<string, number>()
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  timer = null
  const ids = [...queue]
  queue.clear()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from('story_evidence')
      .select('story_id, kind, at, place, distance_km, value, detail')
      .in('story_id', chunk)
    if (error) {
      // Try again next time the story is shown.
      for (const id of chunk) askedAt.delete(id)
      continue
    }
    const found = new Map<string, StoryEvidence[]>()
    for (const row of (data ?? []) as StoryEvidence[]) found.set(row.story_id, [...(found.get(row.story_id) ?? []), row])
    for (const id of chunk) {
      const rows = found.get(id) ?? []
      if (rows.length || byStory.has(id)) byStory.set(id, rows)
    }
  }
}

/** The evidence for a story (fire, then quake, then outage); empty while unknown. */
export function evidenceFor(storyId: string | null | undefined): StoryEvidence[] {
  if (!storyId || !browser) return []
  const at = askedAt.get(storyId)
  if (at === undefined || Date.now() - at > KEEP_MS) {
    askedAt.set(storyId, Date.now())
    queue.add(storyId)
    timer ??= setTimeout(flush, 60)
  }
  const order = { fire: 0, quake: 1, outage: 2 } as const
  return [...(byStory.get(storyId) ?? [])].sort((a, b) => order[a.kind] - order[b.kind])
}
