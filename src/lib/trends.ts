import { ACTORS, type Actor } from './signals'

/** One row of the actor_daily RPC. It also returns a `major` count, which
 *  nothing reads since the site stopped labelling stories major. */
export interface ActorDailyRow { actor: string; day: string; stories: number }

export interface ActorDay { day: string; stories: number }
export interface ActorSeries {
  actor: Actor
  /** Every day in the window, oldest first — days with no stories are zeros, not gaps. */
  days: ActorDay[]
  peak: number
  storiesTotal: number
  stories7: number
  storiesPrev7: number
}

const DAY_MS = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

// Dense daily series per actor from the sparse RPC rows, busiest this week
// first. Actors with nothing in the window are left out; unknown actor keys (a
// vocabulary change) are ignored rather than rendered unlabelled.
export function buildActorSeries(rows: ActorDailyRow[], days: number, now: number): ActorSeries[] {
  const today = Date.parse(iso(now) + 'T00:00:00Z')
  const window = Array.from({ length: days }, (_, i) => iso(today - (days - 1 - i) * DAY_MS))
  const byActor = new Map<string, Map<string, ActorDailyRow>>()
  for (const r of rows) {
    if (!(r.actor in ACTORS)) continue
    let m = byActor.get(r.actor)
    if (!m) byActor.set(r.actor, (m = new Map()))
    m.set(r.day, r)
  }
  const out: ActorSeries[] = []
  for (const [actor, m] of byActor) {
    const filled = window.map((day) => ({ day, stories: Number(m.get(day)?.stories) || 0 }))
    const sum = (xs: ActorDay[]) => xs.reduce((n, d) => n + d.stories, 0)
    const storiesTotal = sum(filled)
    if (storiesTotal === 0) continue
    out.push({
      actor: actor as Actor,
      days: filled,
      peak: Math.max(...filled.map((d) => d.stories)),
      storiesTotal,
      stories7: sum(filled.slice(-7)),
      storiesPrev7: sum(filled.slice(-14, -7)),
    })
  }
  return out.sort((a, b) => b.stories7 - a.stories7 || b.storiesTotal - a.storiesTotal || a.actor.localeCompare(b.actor))
}
