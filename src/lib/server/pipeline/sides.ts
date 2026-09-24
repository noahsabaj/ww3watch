// Stories covered from both sides of a rivalry (src/lib/sides.ts): one Jev
// question per pair of first reports, whether the two sides contradict each
// other. The site shows a contradiction as the story's "disputed" tag, and
// each side's headline under the story either way.
//
// Measured on the three days to 2026-09-24 (78 stories covered from both
// sides): the question below put exactly one over DISPUTED_YES, and it was
// right: TASS carried Lavrov's "Kiev lies, listing soldiers as civilians
// allegedly killed in Bucha" against RFE/RL's "Ballistics tie Russian sniper
// to killings of Ukrainian civilians" (0.87). The highest miss was two
// newsrooms reporting different parts of the EU sanctions deal (0.60). A
// looser wording flagged such pairs too: 1 of 4 flags was right.
import { supabaseAdmin } from '../supabase'
import { callJev } from '../jev'
import { mapPool } from '../pool'
import { sideLabel, storySides } from '../../sides'
import type { Article } from '../../types'
import { bump, type RunStats } from './stats'

const LOOKBACK_HOURS = 36
const CAP = 30

export const disputedQuestion = {
  disputed: {
    type: 'noul',
    instructions:
      'Do `first` and `second` contradict each other about the same event: does one deny, dispute or reverse what the other says happened, who did it or is to blame, or who was killed?',
    criteria: {
      true: {
        what: 'One contradicts the other',
        examples: [
          'Ministry: "Enemy shelled a hospital, killing 5 patients" / Other side: "A stray air defence missile hit the hospital"',
          'Army: "Our strike destroyed a weapons depot" / Other side: "The strike hit a school; 9 children killed"',
          'Ministry: "All 30 drones were shot down" / Other side: "Drones set a fuel depot on fire"',
        ],
      },
      false: {
        what: 'No contradiction: they agree, add different details, give numbers from different moments, cover different parts of the story, or one only reports the news as a claim',
        examples: [
          'Agency: "Rebels target army posts in the north" / Other side: "Rebel attack on army posts kills four"',
          'Agency: "Bloc agrees to extend sanctions" / Other side: "One member blocks removing a businessman from the sanctions list"',
          'Agency: "Army successfully tests new missile" / Other side: "Army claims test of new missile"',
        ],
      },
    },
  },
}

const report = (a: Article) => ({
  outlet: a.source_name,
  side: sideLabel(a),
  headline: a.title,
  summary: (a.summary ?? '').replace(/\s+/g, ' ').slice(0, 250),
})

export async function judgeSides(stats: RunStats, deadlineMs: number, now = Date.now()): Promise<void> {
  try {
    const since = new Date(now - LOOKBACK_HOURS * 3600_000).toISOString()
    const recent: Article[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('articles')
        .select('id, story_id, title, summary, published_at, source_name, source_region, source_affiliation, source_lang, actors')
        .gte('published_at', since)
        .not('story_id', 'is', null)
        .order('id')
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      recent.push(...((data ?? []) as unknown as Article[]))
      if (!data || data.length < 1000) break
    }
    const byStory = new Map<string, Article[]>()
    for (const a of recent) byStory.set(a.story_id!, [...(byStory.get(a.story_id!) ?? []), a])
    const covered = [...byStory.entries()].flatMap(([id, articles]) => {
      const s = storySides(articles)
      return s ? [{ id, ...s }] : []
    })
    if (!covered.length) return

    // Asked once per pair of first reports.
    const asked = new Map<string, string>()
    for (let i = 0; i < covered.length; i += 100) {
      const { data, error } = await supabaseAdmin
        .from('story_sides')
        .select('story_id, first_a, first_b')
        .in('story_id', covered.slice(i, i + 100).map((c) => c.id))
      if (error) throw new Error(error.message)
      for (const r of data ?? []) asked.set(r.story_id, `${r.first_a}|${r.first_b}`)
    }
    const todo = covered.filter((c) => asked.get(c.id) !== `${c.first[0].id}|${c.first[1].id}`).slice(0, CAP)
    const done = await mapPool(todo, 6, async (c) => {
      const { answers, inputTokens } = await callJev({ first: report(c.first[0]), second: report(c.first[1]) }, disputedQuestion, deadlineMs)
      bump(stats, 'sides_tokens', inputTokens)
      const p = answers.disputed?.noul
      return {
        story_id: c.id,
        judged_at: new Date(now).toISOString(),
        sides: c.sides.join('|'),
        first_a: c.first[0].id,
        first_b: c.first[1].id,
        p_disputed: typeof p === 'number' && Number.isFinite(p) ? p : null,
      }
    }, { deadlineMs })
    if (done.failed.length) console.error(`[pipeline] sides: ${done.failed.length} failed (asked again next run):`, String(done.failed[0].error).slice(0, 200))
    const rows = done.done.map((d) => d.value)
    for (const row of rows) {
      // One by one: a story a merge deleted since it was read fails its
      // foreign key, and only that row should be skipped.
      const { error } = await supabaseAdmin.from('story_sides').upsert(row, { onConflict: 'story_id' })
      if (error && error.code !== '23503') throw new Error(error.message)
    }
    bump(stats, 'sides_judged', rows.length)
  } catch (err) {
    stats.sides_error = String(err).slice(0, 200)
    console.error('[pipeline] sides failed (non-fatal):', err)
  }
}
