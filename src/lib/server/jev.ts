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
export const jevQuestions = {
  relevant: {
    type: 'noul',
    instructions: {
      question:
        'Is `article` a news report about armed conflict, military action, or a geopolitical security crisis between or within states?',
      note: 'The article may be written in any language. Judge by what it reports, not by its language.',
    },
    criteria: {
      true: {
        what: 'Reports war, military strikes or operations, armed clashes, terrorism, assassinations, coups or violent regime change, nuclear or missile threats, weapons transfers, military mobilisation, sanctions or ultimatums tied to a conflict, ceasefire or peace negotiations, hostages, or civilians killed or displaced by fighting.',
        examples: [
          'Drone strike hits oil depot in border region',
          'Foreign ministers meet to negotiate ceasefire terms',
          'Army announces mobilisation of reservists',
        ],
      },
      false: {
        what: 'Anything else, even when it names a country that is at war.',
        not_relevant: [
          'Domestic politics, elections, or court cases with no security dimension',
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
  // Speculative: costs a few tokens, answered in parallel, ignored by routing
  // today. Recorded so the eval can show whether it separates the classes.
  topic: {
    type: 'choice',
    instructions: 'Which one subject best describes what `article` reports?',
    criteria: {
      armed_conflict: 'War, battles, strikes, shelling, military operations, or casualties of fighting',
      terrorism_or_assassination: 'Terror attacks, targeted killings, hostage-taking',
      coup_or_unrest: 'Coups, violent regime change, armed uprisings, violently suppressed protests',
      nuclear_or_missiles: 'Nuclear programmes or threats, missile tests, weapons of mass destruction',
      military_posture: 'Mobilisation, deployments, exercises, arms deals and weapons deliveries, defence budgets',
      conflict_diplomacy: 'Sanctions, ultimatums, ceasefire or peace talks, alliances, UN action about a conflict',
      other_politics: 'Domestic politics, elections, courts, or diplomacy with no conflict or security dimension',
      not_politics: 'Economy, business, technology, science, health, sports, culture, weather, crime, accidents',
    },
  },
} as const

export interface JevVerdict {
  /** P(relevant), calibrated, 0-1. */
  relevant: number
  topic: string
  topicConfidence: number
  inputTokens: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_RETRIES = 4

export function jevState(a: JevArticle) {
  const summary = (a.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  // Only what the question needs — Jev loses accuracy to irrelevant state.
  return { article: summary ? { title: a.title, summary, language: a.source_lang } : { title: a.title, language: a.source_lang } }
}

/** One Jev round-trip for one article. 429/529 are retried with backoff. */
export async function askJev(
  article: JevArticle,
  questions: Record<string, unknown> = jevQuestions,
  deadlineMs?: number,
): Promise<JevVerdict> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ state: jevState(article), model: JEV_MODEL, questions }),
      signal: AbortSignal.timeout(15000),
    })
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt
      if (deadlineMs !== undefined && Date.now() + backoff >= deadlineMs) throw new Error(`jev ${res.status}: out of budget`)
      await sleep(backoff)
      continue
    }
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    const relevant = Number(data.answers?.relevant?.noul)
    if (!Number.isFinite(relevant)) throw new Error(`jev: no relevant.noul in ${JSON.stringify(data).slice(0, 200)}`)
    return {
      relevant,
      topic: String(data.answers?.topic?.choice ?? ''),
      topicConfidence: Number(data.answers?.topic?.confidence) || 0,
      inputTokens: Number(data.usage?.input_tokens) || 0,
    }
  }
}
