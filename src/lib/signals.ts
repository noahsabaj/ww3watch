// Per-article signals: typed judgments about an accepted article, made once by
// Jev at ingest (src/lib/server/jev-signals.ts) and stored on the row. They
// ROUTE — filter, sort, badge, rank trending — and never touch what a
// journalist wrote (docs/CONVENTIONS.md). Shared by the pipeline and the client,
// so nothing here may import server-only code.

export const TOPICS = {
  armed_conflict: { label: 'Combat', what: 'War, battles, strikes, shelling, military operations, or casualties of fighting' },
  terrorism_or_assassination: { label: 'Terror & assassination', what: 'Terror attacks, targeted killings, hostage-taking' },
  coup_or_unrest: { label: 'Coups & unrest', what: 'Coups, violent regime change, armed uprisings, violently suppressed protests' },
  nuclear_or_missiles: { label: 'Nuclear & missiles', what: 'Nuclear programmes or threats, missile tests, weapons of mass destruction' },
  military_posture: { label: 'Military posture', what: 'Mobilisation, deployments, exercises, arms deals and weapons deliveries, defence budgets' },
  conflict_diplomacy: { label: 'Diplomacy & sanctions', what: 'Sanctions, ultimatums, ceasefire or peace talks, alliances, UN action about a conflict' },
  other: { label: 'Other', what: 'Anything else: domestic politics, economy, society, or background with no conflict event' },
} as const
export type Topic = keyof typeof TOPICS
export const ALL_TOPICS = Object.keys(TOPICS) as Topic[]

// Parties a reader filters by. `who` is what Jev is asked about, so it names the
// state AND the armed groups a reader would file under it.
export const ACTORS = {
  us: { label: 'United States', who: 'the United States, its government or its military' },
  russia: { label: 'Russia', who: 'Russia, its government or its military' },
  ukraine: { label: 'Ukraine', who: 'Ukraine, its government, military or territory' },
  israel: { label: 'Israel', who: 'Israel, its government or its military' },
  palestine: { label: 'Palestine', who: 'Gaza, the West Bank, the Palestinians, Hamas or Islamic Jihad' },
  iran: { label: 'Iran', who: 'Iran, its government, the IRGC or its nuclear programme' },
  lebanon: { label: 'Lebanon', who: 'Lebanon or Hezbollah' },
  syria: { label: 'Syria', who: 'Syria, its government or armed groups fighting there' },
  iraq: { label: 'Iraq', who: 'Iraq or armed groups operating there' },
  yemen: { label: 'Yemen', who: 'Yemen or the Houthis' },
  gulf: { label: 'Gulf states', who: 'Saudi Arabia, the UAE, Qatar, Kuwait, Bahrain or Oman' },
  turkey: { label: 'Türkiye', who: 'Türkiye (Turkey), its government or its military' },
  china: { label: 'China', who: 'China, its government or its military' },
  taiwan: { label: 'Taiwan', who: 'Taiwan or the Taiwan Strait' },
  koreas: { label: 'Koreas', who: 'North Korea or South Korea' },
  india_pakistan: { label: 'India & Pakistan', who: 'India, Pakistan or Kashmir' },
  afghanistan: { label: 'Afghanistan', who: 'Afghanistan or the Taliban' },
  europe_nato: { label: 'Europe & NATO', who: 'NATO, the European Union, or a European state other than Russia and Ukraine' },
  africa: { label: 'Africa', who: 'an African state or an armed group in Africa (Sudan, Sahel, Congo, Somalia, Ethiopia, Libya…)' },
  latin_america: { label: 'Latin America', who: 'a Latin American or Caribbean state or an armed group there' },
} as const
export type Actor = keyof typeof ACTORS
export const ALL_ACTORS = Object.keys(ACTORS) as Actor[]

// Severity is stored normalised to 0-1 (Jev's score ÷ top level), so the scale
// can gain a level without re-thresholding every consumer.
export const SEVERITY_LEVELS = [
  'Commentary, a statement, routine diplomacy, or background — no new event on the ground',
  'A limited development: a localised clash, an arrest, a sanction, an exercise, an arms delivery, a round of talks',
  'A significant event: a deadly strike or attack, a major offensive, mass casualties, a ceasefire collapsing, one state openly escalating against another',
  'An event with global consequences: war between states beginning or widening, nuclear use, test or direct nuclear threat, a head of state killed or overthrown, great powers clashing directly',
] as const
/** "Major only" cut: at or above a significant event. */
export const MAJOR_SEVERITY = 0.55
/** A Noul at or above this reads as yes for badges and filters. */
export const SIGNAL_YES = 0.7

export interface ArticleSignals {
  topic: Topic | null
  /** 0-1. */
  severity: number | null
  /** P(mainly reports what someone SAID — threat, claim, accusation — not an event). */
  claim: number | null
  /** P(the central fact is presented as unconfirmed). */
  unverified: number | null
  /** P(opinion / analysis / explainer rather than a news report). */
  opinion: number | null
  actors: Actor[] | null
  /** Jev's P(relevant), recorded for every accepted article — a free audit of
   *  whichever tier accepted it. */
  jev_relevant: number | null
}

export const isMajor = (a: Pick<ArticleSignals, 'severity'>): boolean => (a.severity ?? 0) >= MAJOR_SEVERITY
export const isClaim = (a: Pick<ArticleSignals, 'claim'>): boolean => (a.claim ?? 0) >= SIGNAL_YES
export const isUnverified = (a: Pick<ArticleSignals, 'unverified'>): boolean => (a.unverified ?? 0) >= SIGNAL_YES
export const isOpinion = (a: Pick<ArticleSignals, 'opinion'>): boolean => (a.opinion ?? 0) >= SIGNAL_YES
