import { callJev, jevState, jevQuestions, type JevArticle } from './jev'
import { ACTORS, ALL_ACTORS, ALL_TOPICS, SEVERITY_LEVELS, SIGNAL_YES, TOPICS, type Actor, type ArticleSignals, type Topic } from '../signals'

// Every signal for one article in ONE request. Jev answers each question
// independently and in parallel against the same state, so the ~25 questions
// cost tokens but no extra latency and cannot contaminate each other
// (https://docs.typesafe.ai/patterns/fan-out). Each is narrow and literal on
// purpose: Jev answers the question as written, not the one that was meant.
export const signalQuestions: Record<string, unknown> = {
  relevant: jevQuestions.relevant,
  topic: {
    type: 'choice',
    instructions: 'Which one subject best describes what `article` reports?',
    criteria: Object.fromEntries(ALL_TOPICS.map((t) => [t, TOPICS[t].what])),
  },
  severity: {
    type: 'score',
    instructions: {
      question: 'How consequential is the event `article` reports?',
      focus: 'Judge the event itself, not how dramatic the wording is. A threat or statement about a grave subject is still a statement.',
    },
    criteria: [...SEVERITY_LEVELS],
  },
  claim: {
    type: 'noul',
    instructions:
      'Does `article` mainly report what someone SAID — a threat, warning, claim, accusation, denial, or promise — rather than an event that has already happened?',
    criteria: {
      true: { what: 'The news is the statement itself', examples: ['Minister warns of "crushing response"', 'Spokesman denies involvement in the attack'] },
      false: { what: 'The news is something that happened', examples: ['Airstrike kills 9 in the capital', 'Parliament votes to extend martial law'] },
    },
  },
  unverified: {
    type: 'noul',
    instructions:
      'Does `article` present its central fact as unconfirmed — attributed to unnamed sources, to one side\'s claim, or hedged with words like "reportedly", "allegedly", or "unverified"?',
  },
  opinion: {
    type: 'noul',
    instructions:
      'Is `article` an opinion piece, editorial, analysis, explainer, interview, or live-blog summary, rather than a news report of a specific current event?',
  },
  ...Object.fromEntries(
    ALL_ACTORS.map((k) => [
      `actor_${k}`,
      {
        type: 'noul',
        instructions: `Is ${ACTORS[k].who} directly involved in what \`article\` reports — as a party acting or acted upon, or as the place where it happens?`,
        criteria: { false: 'Not mentioned, or mentioned only in passing as background' },
      },
    ]),
  ),
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function askSignals(article: JevArticle, deadlineMs?: number): Promise<ArticleSignals & { inputTokens: number }> {
  const { answers, inputTokens } = await callJev(jevState(article), signalQuestions, deadlineMs)
  const topic = answers.topic?.choice
  const score = num(answers.severity?.score)
  const actors: Actor[] = ALL_ACTORS.filter((k) => (num(answers[`actor_${k}`]?.noul) ?? 0) >= SIGNAL_YES)
  return {
    topic: topic && topic in TOPICS ? (topic as Topic) : null,
    severity: score === null ? null : Math.min(1, Math.max(0, score / (SEVERITY_LEVELS.length - 1))),
    claim: num(answers.claim?.noul),
    unverified: num(answers.unverified?.noul),
    opinion: num(answers.opinion?.noul),
    actors,
    jev_relevant: num(answers.relevant?.noul),
    inputTokens,
  }
}
