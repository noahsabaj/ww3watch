import { createHash } from 'node:crypto'
import { callJev, JEV_MODEL } from './jev'
import { SEVERITY_LEVELS } from '../signals'
import { corroboration } from '../story'

export { corroboration }

// Trending without a generative model. Jev makes the three judgments that need
// language (how consequential, is it new, is it only talk) once per candidate
// story, in parallel, and CODE does the weighing — with the corroboration counts
// it already computes exactly. Changing what "trending" means is a coefficient
// here, not a prompt rewrite. (This replaced an LLM curator that was handed 20
// headlines and asked to reason its way to three indices.)

export interface TrendingCandidate {
  headline: string
  /** Other outlets' headlines for the same story (any language), newest first. */
  otherHeadlines: string[]
  independent: number
  regions: number
  langs: number
}

export interface StoryJudgment {
  /** 0-1: Jev's severity score ÷ top level. */
  severity: number
  /** P(a new development, not background / recap / commentary). */
  fresh: number
  /** P(the story is only a statement — threat, claim, denial — not an event). */
  talk: number
}

const questions = {
  severity: {
    type: 'score',
    instructions: {
      question: 'How consequential is the event `story` reports?',
      focus: 'Judge the event itself, not how dramatic the wording is. A threat or statement about a grave subject is still a statement.',
    },
    criteria: [...SEVERITY_LEVELS],
  },
  fresh: {
    type: 'noul',
    instructions:
      'Does `story` report a NEW development — something that has just happened or just been announced — rather than ongoing background, a recap, an anniversary, or commentary?',
  },
  talk: {
    type: 'noul',
    instructions:
      'Is `story` only about what someone SAID — a threat, warning, claim, accusation, denial, or promise — with no event that has actually happened?',
  },
}

export const WEIGHTS = { severity: 0.45, corroboration: 0.3, fresh: 0.25, talkPenalty: 0.15 }

export function trendingScore(c: TrendingCandidate, j: StoryJudgment): number {
  return (
    WEIGHTS.severity * j.severity +
    WEIGHTS.corroboration * corroboration(c) +
    WEIGHTS.fresh * j.fresh -
    WEIGHTS.talkPenalty * j.talk
  )
}

const stateOf = (c: TrendingCandidate) => ({ story: { headline: c.headline, other_headlines: c.otherHeadlines.slice(0, 4) } })

// A story that hasn't changed since the last ranking would be asked the same
// three questions about the same headlines again: 19 of the top 20 candidates
// were unchanged over 15 minutes (2026-09-23). Answers are kept by exactly what
// Jev is asked — model, questions and state — so a reused answer is the answer
// to the identical question, and a new wording or model pin asks afresh.
export function judgmentKey(c: TrendingCandidate): string {
  return createHash('sha256').update(JSON.stringify({ model: JEV_MODEL, questions, state: stateOf(c) })).digest('hex')
}

export interface JudgmentCache {
  get(keys: string[]): Promise<Map<string, StoryJudgment>>
  put(entries: Array<{ key: string; judgment: StoryJudgment }>): Promise<void>
}

async function judge(c: TrendingCandidate, deadlineMs?: number): Promise<StoryJudgment> {
  const { answers } = await callJev(stateOf(c), questions, deadlineMs)
  const score = Number(answers.severity?.score)
  const fresh = Number(answers.fresh?.noul)
  const talk = Number(answers.talk?.noul)
  if (![score, fresh, talk].every(Number.isFinite)) throw new Error('jev: incomplete trending answers')
  return { severity: Math.min(1, Math.max(0, score / (SEVERITY_LEVELS.length - 1))), fresh, talk }
}

/**
 * Rank candidates; returns the indices of the top `pick`, best first — or null
 * when too few candidates could be judged to trust the ranking (the caller
 * keeps the previous selection).
 */
export async function rankWithJev(
  candidates: TrendingCandidate[],
  pick: number,
  deadlineMs?: number,
  cache?: JudgmentCache,
  counts?: { asked: number; reused: number },
): Promise<{ indices: number[]; scores: number[] } | null> {
  const keys = candidates.map(judgmentKey)
  // The cache only ever saves a call; if it can't be read, everything is asked.
  const known = cache
    ? await cache.get(keys).catch((err) => {
        console.warn('[trending] judgment cache unavailable, asking every candidate:', err)
        return new Map<string, StoryJudgment>()
      })
    : new Map<string, StoryJudgment>()
  const settled = await Promise.allSettled(candidates.map((c, i) => {
    const hit = known.get(keys[i])
    return hit ? Promise.resolve(hit) : judge(c, deadlineMs)
  }))
  const asked = settled.flatMap((r, i) => (r.status === 'fulfilled' && !known.has(keys[i]) ? [{ key: keys[i], judgment: r.value }] : []))
  if (counts) {
    counts.reused += candidates.filter((_, i) => known.has(keys[i])).length
    counts.asked += candidates.length - candidates.filter((_, i) => known.has(keys[i])).length
  }
  if (cache && asked.length > 0) await cache.put(asked).catch((err) => console.warn('[trending] judgment cache write failed:', err))
  const ranked = settled
    .map((r, i) => (r.status === 'fulfilled' ? { i, score: trendingScore(candidates[i], r.value) } : null))
    .filter((x): x is { i: number; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
  const failed = candidates.length - ranked.length
  if (failed > 0) console.warn(`[trending] jev judged ${ranked.length}/${candidates.length} candidates`)
  if (ranked.length < pick || failed > candidates.length / 2) return null
  const top = ranked.slice(0, pick)
  return { indices: top.map((r) => r.i), scores: top.map((r) => +r.score.toFixed(3)) }
}
