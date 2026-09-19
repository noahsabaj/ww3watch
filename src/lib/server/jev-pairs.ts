import { callJev } from './jev'
import { PAIR_BAND, PAIR_NO, PAIR_YES } from './config'

// Story grouping's grey zone. Embedding similarity measures "about the same
// SUBJECT": at the 0.83 threshold, two different events in the same war land
// within a few hundredths of two reports of one event. A sample of prod joins at
// similarity 0.83-0.88 was mostly wrong merges (an election story under a
// "provocations at polling stations" rep; "AfD pressures German aid" under a
// Georgian official's statement). Far above the threshold the embedding is
// right; far below it too. In between, one narrow question settles what a
// number cannot: is this the same EVENT?
export const sameEventQuestions = {
  same_event: {
    type: 'noul',
    instructions: {
      question:
        'Do `headline_a` and `headline_b` belong to the SAME news story — reports of one specific event (one incident, announcement, decision or statement), including its immediate aftermath and direct official reactions to it?',
      note: 'The two headlines may be in different languages. Sharing a topic, a war, a country or a person is NOT enough.',
    },
    criteria: {
      true: {
        what: 'Two reports of one specific event — even if worded differently, from opposing sides, or with different figures — or a direct update, all-clear, or official reaction to that same event',
        examples: [
          ['Missile strike kills 12 in apartment block in the city', 'At least 12 dead after residential building hit'],
          ['Explosions heard in the capital as air raid alert issued', 'Authorities send all-clear after alerts in the capital'],
          ['Government condemns deadly mosque attack', 'Neighbouring state condemns terrorist attack near mosque'],
        ],
      },
      false: {
        what: 'Different events, even in the same conflict or involving the same people; or a broad analysis, explainer or round-up rather than that one event',
        examples: [
          ['Missile strike kills 12 in one city', 'Drone attack on a port in another city injures 3'],
          ['Cabinet condemns rebel attacks', 'What to know after a week of rebel attacks on oil facilities'],
          ['Parliamentary election voting begins', 'Official alleges provocations at polling stations'],
        ],
      },
    },
  },
} as const

export { PAIR_BAND, PAIR_NO, PAIR_YES }

export type PairVerdict = 'same' | 'different' | 'unsure'

export async function judgeSameEvent(a: string, b: string, deadlineMs?: number): Promise<{ verdict: PairVerdict; p: number }> {
  const { answers } = await callJev({ headline_a: a, headline_b: b }, sameEventQuestions, deadlineMs)
  const p = Number(answers.same_event?.noul)
  if (!Number.isFinite(p)) throw new Error('jev: no same_event.noul')
  return { verdict: p >= PAIR_YES ? 'same' : p <= PAIR_NO ? 'different' : 'unsure', p }
}
