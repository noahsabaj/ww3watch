import { callJev } from './jev'
import { SEVERITY_LEVELS } from '../signals'

// Trending without a generative model. The LLM curator was handed 20 headlines
// and asked to reason its way to three indices — one slow, rate-limited call
// whose weighing of significance vs. corroboration vs. novelty lived inside a
// prompt. Here Jev makes the three judgments that need language (how
// consequential, is it new, is it only talk) once per candidate story, in
// parallel, and CODE does the weighing — with the corroboration counts it
// already computes exactly. Changing what "trending" means is now a coefficient,
// not a prompt rewrite.

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

// Counting is code's job, not the model's. Log-scaled: the step from 1 source to
// 3 is worth more than from 9 to 11. Breadth across regions and languages is
// the strongest sign a story is real and not one bloc's echo.
export function corroboration(c: Pick<TrendingCandidate, 'independent' | 'regions' | 'langs'>): number {
  const sources = Math.min(1, Math.log2(1 + c.independent) / Math.log2(1 + 8))
  const regions = Math.min(1, (c.regions - 1) / 3)
  const langs = Math.min(1, (c.langs - 1) / 2)
  return 0.6 * sources + 0.25 * regions + 0.15 * langs
}

export function trendingScore(c: TrendingCandidate, j: StoryJudgment): number {
  return (
    WEIGHTS.severity * j.severity +
    WEIGHTS.corroboration * corroboration(c) +
    WEIGHTS.fresh * j.fresh -
    WEIGHTS.talkPenalty * j.talk
  )
}

async function judge(c: TrendingCandidate, deadlineMs?: number): Promise<StoryJudgment> {
  const state = { story: { headline: c.headline, other_headlines: c.otherHeadlines.slice(0, 4) } }
  const { answers } = await callJev(state, questions, deadlineMs)
  const score = Number(answers.severity?.score)
  const fresh = Number(answers.fresh?.noul)
  const talk = Number(answers.talk?.noul)
  if (![score, fresh, talk].every(Number.isFinite)) throw new Error('jev: incomplete trending answers')
  return { severity: Math.min(1, Math.max(0, score / (SEVERITY_LEVELS.length - 1))), fresh, talk }
}

/**
 * Rank candidates; returns the indices of the top `pick`, best first — or null
 * when too few candidates could be judged to trust the ranking (the caller
 * falls back to the LLM, or keeps the previous selection).
 */
export async function rankWithJev(
  candidates: TrendingCandidate[],
  pick: number,
  deadlineMs?: number,
): Promise<{ indices: number[]; scores: number[] } | null> {
  const settled = await Promise.allSettled(candidates.map((c) => judge(c, deadlineMs)))
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
