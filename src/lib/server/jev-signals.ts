import { callJev, jevState, jevQuestions, type JevArticle } from './jev'
import { ACTORS, ALL_ACTORS, SEVERITY_LEVELS, SIGNAL_YES, type Actor, type ArticleSignals } from '../signals'

// What this costs is almost entirely the QUESTIONS (the state is one headline):
// ~2,550 input tokens with everything, ~1,800 without the relevance question,
// before the topic question was dropped (2026-09-23): nothing had read its
// answer since the topic filter went (#139), and it was ~11% of every request.
// So the relevance question is only asked when nobody has asked it yet — the
// local head's accepts. For an article Jev itself accepted minutes earlier, the
// same question over the same state would buy the same number again.
//
// Every signal for one article in ONE request. Jev answers each question
// independently and in parallel against the same state, so the ~25 questions
// cost tokens but no extra latency and cannot contaminate each other
// (https://docs.typesafe.ai/patterns/fan-out). Each is narrow and literal on
// purpose: Jev answers the question as written, not the one that was meant.
const annotationQuestions: Record<string, unknown> = {
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
  // Severity rates the event a report describes, whenever it happened, so a
  // look back at the 1980 invasion of Iran scored 0.99. Over 227 hand-labelled
  // headlines from the week of 2026-09-24, at 0.7 this caught 15 of 18 looks
  // back and flagged no report of a current event (3 analysis pieces, which
  // are not news either). Rewording severity itself instead pushed real
  // strikes and North Korea's missile tests below "major"
  // (docs/evals/2026-09-24-jev-retrospective.md).
  retrospective: {
    type: 'noul',
    instructions:
      'Is `article` chiefly about something that happened long ago (more than a few weeks before it was written): history, an anniversary or commemoration, or a new study, trial or revelation about an old event?',
    criteria: {
      true: {
        what: 'It looks back: the main event happened months or years ago',
        examples: ['Forty years on, survivors recall the siege of the city', 'Declassified files show the 1983 standoff nearly went nuclear', 'The day the invasion began: what happened in its first hours'],
      },
      false: {
        what: 'The main event happened in the past few days, or is still unfolding',
        examples: ['Missile strike on a market kills 12', 'President warns of retaliation on the war anniversary', 'Fuel prices climb as the war enters its seventh month'],
      },
    },
  },
  ...Object.fromEntries(
    ALL_ACTORS.map((k) => [
      `actor_${k}`,
      // No `criteria`: on a side-by-side over real headlines the actor sets came
      // out the same (one better) without it, and 20 copies of it were ~500
      // tokens per article. The wording of the instruction is what matters — a
      // shorter one ("directly involved in the event") lost parties and
      // invented one.
      {
        type: 'noul',
        instructions: `Is ${ACTORS[k].who} directly involved in what \`article\` reports — as a party acting or acted upon, or as the place where it happens?`,
      },
    ]),
  ),
}

/** The full set: annotations plus the relevance question. */
export const signalQuestions: Record<string, unknown> = { relevant: jevQuestions.relevant, ...annotationQuestions }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * @param knownRelevant Jev's P(relevant) if the classify stage already asked —
 *   the relevance question is then left out and this value is passed through.
 */
export async function askSignals(
  article: JevArticle,
  deadlineMs?: number,
  knownRelevant: number | null = null,
): Promise<ArticleSignals & { inputTokens: number }> {
  const questions = knownRelevant === null ? signalQuestions : annotationQuestions
  const { answers, inputTokens } = await callJev(jevState(article), questions, deadlineMs)
  const score = num(answers.severity?.score)
  const actors: Actor[] = ALL_ACTORS.filter((k) => (num(answers[`actor_${k}`]?.noul) ?? 0) >= SIGNAL_YES)
  return {
    // No longer asked (see top of file); the column keeps older rows' values.
    topic: null,
    severity: score === null ? null : Math.min(1, Math.max(0, score / (SEVERITY_LEVELS.length - 1))),
    claim: num(answers.claim?.noul),
    unverified: num(answers.unverified?.noul),
    opinion: num(answers.opinion?.noul),
    retrospective: num(answers.retrospective?.noul),
    actors,
    jev_relevant: knownRelevant ?? num(answers.relevant?.noul),
    inputTokens,
  }
}
