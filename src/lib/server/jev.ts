import { reserveClassification } from './ai-budget'
// TypeSafe's Jev — a "System One" model: it does not generate text, it returns
// calibrated probabilities for typed questions about a state. One request per
// article, every question answered in parallel against that article alone
// (https://docs.typesafe.ai). Like every other model in this pipeline it only
// ROUTES; it cannot rewrite what a journalist wrote (docs/CONVENTIONS.md).
//
// Deliberately independent of ./env so the offline eval can import it without
// the pipeline's required variables.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
// Pinned, not `jev-latest`: the accept/reject bands are tuned against this
// version's probabilities, and an alias moves without a change on our side.
export const JEV_MODEL = process.env.JEV_MODEL || 'jev-1.13.0'

export interface JevArticle {
  title: string
  summary: string | null
  source_lang: string
}

// Jev reads literally: the question must state the condition, and the criteria
// must carry the boundary cases, because it will not infer intent.
//
// Scope is the question, not the threshold. It covers the diplomacy, alliances
// and wartime domestic politics around a conflict as well as the fighting: the
// fighting-only wording dropped ~88% of such stories the feed used to carry
// (docs/evals/2026-09-19-jev-relevance.md). Re-record the regression baseline
// after any wording change.
export const jevQuestions = {
  relevant: {
    type: 'noul',
    instructions: {
      question:
        'Is `article` a news report about armed conflict, military action, a geopolitical or security crisis, or the politics and diplomacy of states involved in one?',
      note: 'The article may be written in any language. Judge by what it reports, not by its language.',
    },
    criteria: {
      true: {
        what: 'Reports war, military strikes or operations, armed clashes, terrorism, assassinations, coups or regime change, nuclear or missile threats, weapons transfers, military mobilisation, sanctions or ultimatums, ceasefire or peace negotiations, hostages, or civilians killed or displaced by fighting. Also: diplomacy, official statements and disputes between rival powers or about a conflict; military alliances, defence policy and arms build-ups; occupation, annexation and territorial disputes; hybrid threats such as drone incursions, sabotage and cyberattacks; and the domestic politics of a state at war or in crisis when it bears on the conflict or on who leads the country (elections, leadership changes, mass protests, crackdowns).',
        examples: [
          'Drone strike hits oil depot in border region',
          'Foreign ministers meet to negotiate ceasefire terms',
          'Army announces mobilisation of reservists',
          'Wartime president faces snap election after coalition collapses',
          'Alliance names new top general as tensions rise',
          'Unidentified drones shut airport; government suspects foreign state',
        ],
      },
      false: {
        what: 'Anything else, even when it names a country that is at war.',
        not_relevant: [
          'Routine domestic politics, elections, or court cases in countries not at war or in crisis',
          'Business, markets, technology, science, health, weather, or natural disasters',
          'Sports, culture, entertainment, lifestyle, or travel',
          'Ordinary crime or accidents',
          'Historical anniversaries or opinion essays with no current event',
        ],
        examples: [
          'Central bank holds interest rates steady',
          'National team wins qualifier',
          'Parliament debates pension reform',
        ],
      },
    },
  },
} as const

export interface JevVerdict {
  /** P(relevant), calibrated, 0-1. */
  relevant: number
  inputTokens: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_RETRIES = 4

export function jevState(a: JevArticle) {
  const summary = (a.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  // Only what the question needs — Jev loses accuracy to irrelevant state.
  return { article: summary ? { title: a.title, summary, language: a.source_lang } : { title: a.title, language: a.source_lang } }
}

export interface JevResponse {
  answers: Record<string, { noul?: number; choice?: string; score?: number; confidence?: number; probabilities?: Record<string, number> }>
  inputTokens: number
}

/** One Jev round-trip: any state, any typed questions. 429/529 retried with backoff. */
export async function callJev(state: unknown, questions: Record<string, unknown>, deadlineMs?: number): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
  for (let attempt = 0; ; attempt++) {
    const request = JSON.stringify({ state, model: JEV_MODEL, questions })
    const settle = await reserveClassification(JEV_MODEL, request, deadlineMs)
    let res: Response
    let data: { answers?: JevResponse['answers']; usage?: { input_tokens?: number } } | null
    try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: request,
      signal: AbortSignal.timeout(15000),
    })
    data = await res.clone().json().catch(() => null)
    await settle(data?.usage?.input_tokens)
    } catch (error) { await settle(); throw error }
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt
      if (deadlineMs !== undefined && Date.now() + backoff >= deadlineMs) throw new Error(`jev ${res.status}: out of budget`)
      await sleep(backoff)
      continue
    }
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`)
    if (!data?.answers || typeof data.answers !== 'object') throw new Error(`jev: no answers in ${JSON.stringify(data).slice(0, 200)}`)
    return { answers: data.answers, inputTokens: Number(data.usage?.input_tokens) || 0 }
  }
}

/** Relevance verdict for one article. */
export async function askJev(
  article: JevArticle,
  questions: Record<string, unknown> = jevQuestions,
  deadlineMs?: number,
): Promise<JevVerdict> {
  const { answers, inputTokens } = await callJev(jevState(article), questions, deadlineMs)
  const relevant = Number(answers.relevant?.noul)
  if (!Number.isFinite(relevant)) throw new Error(`jev: no relevant.noul in ${JSON.stringify(answers).slice(0, 200)}`)
  return { relevant, inputTokens }
}
