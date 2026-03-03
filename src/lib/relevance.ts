const SINGLE_KEYWORDS = new Set([
  // Direct conflict
  'war', 'warfare', 'warzone', 'combat', 'battle', 'fighting', 'clash', 'clashes',
  'military', 'troops', 'soldier', 'soldiers', 'forces', 'army', 'navy',
  'strike', 'airstrike', 'bombing', 'bomb', 'missile', 'rocket', 'drone',
  'attack', 'attacked', 'offensive', 'invasion', 'invaded', 'incursion', 'raid',
  'siege', 'blockade', 'occupation', 'occupied',
  'weapon', 'weapons', 'arms', 'artillery', 'warship',
  'casualty', 'casualties', 'killed', 'wounded', 'fatalities',
  'ceasefire', 'truce', 'armistice',
  'nuclear', 'warhead',
  'genocide', 'massacre',
  'hostage', 'captive',
  'escalation', 'escalate', 'escalating',
  'ultimatum',
  'refugee', 'displaced', 'evacuation',
  'terrorist', 'terrorism',
  'geopolitical', 'geopolitics',
  'coup', 'overthrow',
  'sanctions', 'sanction', 'embargo',
  'espionage', 'intelligence',
  // Key actors
  'iran', 'iranian', 'irgc',
  'israel', 'israeli', 'idf', 'mossad', 'netanyahu',
  'hamas', 'hezbollah',
  'houthi', 'houthis', 'ansarallah',
  'isis', 'isil', 'daesh',
  'wagner', 'pkk',
  'pentagon', 'centcom',
  'zelensky', 'zelenskyy', 'putin',
  // Geographies
  'gaza', 'palestine', 'palestinian',
  'lebanon', 'lebanese', 'beirut',
  'syria', 'syrian', 'damascus',
  'iraq', 'iraqi', 'baghdad',
  'yemen', 'yemeni',
  'ukraine', 'ukrainian', 'kyiv',
  'russia', 'russian', 'kremlin',
  'taiwan',
  'sudan', 'sudanese',
  'myanmar', 'burma',
  'nagorno', 'karabakh',
  // Orgs / alliances
  'nato',
])

const PHRASE_KEYWORDS = [
  'air strike', 'air force', 'ground offensive', 'proxy war',
  'war crime', 'chemical weapon', 'biological weapon',
  'north korea',
  'south china sea', 'taiwan strait',
  'revolutionary guard', 'quds force',
  'islamic jihad', 'al-qaeda', 'al qaeda',
  'arms deal', 'weapons supply',
  'regime change',
  'humanitarian crisis', 'humanitarian corridor',
  'security council', 'international court',
  'nuclear deal', 'jcpoa',
  'cease-fire',
  'prisoner of war',
  'axis of resistance',
  'iron dome',
]

export function isRelevant(title: string, summary: string, lang: string): boolean {
  if (lang !== 'en') return true

  const text = `${title} ${summary}`.toLowerCase()
  const words = new Set(text.split(/\W+/))

  for (const word of words) {
    if (SINGLE_KEYWORDS.has(word)) return true
  }

  return PHRASE_KEYWORDS.some(phrase => text.includes(phrase))
}
