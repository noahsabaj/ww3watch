// What the pipeline noted about the stories on screen, fetched in batches as
// stories render and kept per story for a few minutes: sensor evidence (a
// satellite pass can add a fire hours after a story was first read) and
// whether its two sides contradict each other.
import { SvelteMap } from 'svelte/reactivity'
import { browser } from '$app/environment'
import { supabase } from './supabase'
import type { StoryEvidence } from './evidence-text'
import { DISPUTED_YES } from './sides'

const KEEP_MS = 10 * 60_000
const evidence = new SvelteMap<string, StoryEvidence[]>()
const disputed = new SvelteMap<string, boolean>()
const askedAt = new Map<string, number>()
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  timer = null
  const ids = [...queue]
  queue.clear()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [ev, sides] = await Promise.all([
      supabase.from('story_evidence').select('story_id, kind, at, place, distance_km, value, detail').in('story_id', chunk),
      supabase.from('story_sides').select('story_id, p_disputed').in('story_id', chunk),
    ])
    if (ev.error || sides.error) {
      // Try again next time the story is shown.
      for (const id of chunk) askedAt.delete(id)
      continue
    }
    const found = new Map<string, StoryEvidence[]>()
    for (const row of (ev.data ?? []) as StoryEvidence[]) found.set(row.story_id, [...(found.get(row.story_id) ?? []), row])
    const contested = new Set((sides.data ?? []).filter((r) => (r.p_disputed ?? 0) >= DISPUTED_YES).map((r) => r.story_id))
    for (const id of chunk) {
      const rows = found.get(id) ?? []
      if (rows.length || evidence.has(id)) evidence.set(id, rows)
      if (contested.has(id) || disputed.has(id)) disputed.set(id, contested.has(id))
    }
  }
}

function ask(storyId: string): void {
  const at = askedAt.get(storyId)
  if (at === undefined || Date.now() - at > KEEP_MS) {
    askedAt.set(storyId, Date.now())
    queue.add(storyId)
    timer ??= setTimeout(flush, 60)
  }
}

/** The evidence for a story (fire, then quake, then outage); empty while unknown. */
export function evidenceFor(storyId: string | null | undefined): StoryEvidence[] {
  if (!storyId || !browser) return []
  ask(storyId)
  const order = { fire: 0, quake: 1, outage: 2 } as const
  return [...(evidence.get(storyId) ?? [])].sort((a, b) => order[a.kind] - order[b.kind])
}

/** Whether the story's two sides contradict each other (src/lib/server/pipeline/sides.ts). */
export function disputedFor(storyId: string | null | undefined): boolean {
  if (!storyId || !browser) return false
  ask(storyId)
  return disputed.get(storyId) ?? false
}
