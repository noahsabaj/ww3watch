// Offline evaluation: how well does TypeSafe's Jev (a System One model that
// returns calibrated probabilities, not text) reproduce the LLM's relevance
// verdicts, per language? Labels are the same ones train-classifier.ts uses:
// positives = accepted articles, negatives = classified_rejects reason='llm'.
// Titles only, because that is all classified_rejects keeps.
//
//   node --import tsx --env-file=.env scripts/eval-jev.ts [outfile.json]
//
// Writes nothing to the database.
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { jevQuestions, askJev, type JevVerdict } from '../src/lib/server/jev'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('need SUPABASE_URL + SUPABASE_SECRET_KEY')
const supabase = createClient(url, key, { auth: { persistSession: false } })

// Per-language sample size PER CLASS.
const PLAN: Record<string, number> = { en: 200, fa: 150, ru: 150, ar: 100, he: 60, tr: 60, uk: 60 }
// Before the local head started accepting on its own (2026-09-13T22:19Z), every
// row in `articles` carried a real LLM verdict.
const LLM_ONLY_BEFORE = '2026-09-13T22:00:00Z'
const POOL = 2000
const CONCURRENCY = 16

// mulberry32 — seeded so a re-run samples the same rows.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function sample<T>(rows: T[], n: number, random: () => number): T[] {
  const a = [...rows]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

interface Row { title: string; lang: string; label: 0 | 1 }

async function load(lang: string, n: number, random: () => number): Promise<Row[]> {
  const pos = await supabase
    .from('articles').select('title').eq('source_lang', lang).lt('fetched_at', LLM_ONLY_BEFORE)
    .order('fetched_at', { ascending: false }).limit(POOL)
  const neg = await supabase
    .from('classified_rejects').select('title').eq('lang', lang).eq('reason', 'llm')
    .order('rejected_at', { ascending: false }).limit(POOL)
  if (pos.error || neg.error) throw new Error(JSON.stringify(pos.error ?? neg.error))
  const clean = (rows: Array<{ title: string | null }>) => rows.filter((r) => (r.title ?? '').trim().length > 0) as Array<{ title: string }>
  return [
    ...sample(clean(pos.data), n, random).map((r) => ({ title: r.title, lang, label: 1 as const })),
    ...sample(clean(neg.data), n, random).map((r) => ({ title: r.title, lang, label: 0 as const })),
  ]
}

async function main() {
  const random = rng(20260918)
  const rows: Row[] = []
  for (const [lang, n] of Object.entries(PLAN)) rows.push(...(await load(lang, n, random)))
  console.log(`sampled ${rows.length} titles`)

  const out: Array<Row & JevVerdict> = []
  let tokens = 0
  let failed = 0
  const t0 = Date.now()
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++]
        try {
          const v = await askJev({ title: row.title, summary: null, source_lang: row.lang }, jevQuestions)
          tokens += v.inputTokens
          out.push({ ...row, ...v })
        } catch (err) {
          failed++
          if (failed <= 3) console.error('jev call failed:', String(err).slice(0, 200))
        }
      }
    }),
  )
  const secs = (Date.now() - t0) / 1000
  console.log(
    `${out.length} judged, ${failed} failed, ${secs.toFixed(0)}s, ${tokens} input tokens ` +
      `(${(tokens / Math.max(1, out.length)).toFixed(0)}/article, $${((tokens / 1e6) * 0.042).toFixed(4)})`,
  )

  const file = process.argv[2] ?? 'jev-eval.json'
  writeFileSync(file, JSON.stringify(out))
  console.log(`raw results → ${file}`)
  report(out)
}

function auc(rows: Array<{ label: 0 | 1; relevant: number }>): number {
  const pos = rows.filter((r) => r.label === 1)
  const neg = rows.filter((r) => r.label === 0)
  if (!pos.length || !neg.length) return NaN
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p.relevant > n.relevant ? 1 : p.relevant === n.relevant ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

export function report(out: Array<Row & JevVerdict>, lo = 0.3, hi = 0.7): void {
  const groups = new Map<string, typeof out>([['ALL', out]])
  for (const r of out) groups.set(r.lang, [...(groups.get(r.lang) ?? []), r])
  console.log(`\nbands: reject ≤ ${lo}, accept ≥ ${hi}`)
  console.log('lang |    n |  AUC  | acc@.5 | settled | false-accept | false-reject')
  for (const [lang, g] of groups) {
    const acc = g.filter((r) => (r.relevant >= 0.5 ? 1 : 0) === r.label).length / g.length
    const accepted = g.filter((r) => r.relevant >= hi)
    const rejected = g.filter((r) => r.relevant <= lo)
    const fa = accepted.filter((r) => r.label === 0).length / Math.max(1, accepted.length)
    const fr = rejected.filter((r) => r.label === 1).length / Math.max(1, rejected.length)
    const pct = (x: number) => (100 * x).toFixed(1).padStart(5) + '%'
    console.log(
      `${lang.padEnd(4)} | ${String(g.length).padStart(4)} | ${auc(g).toFixed(3)} | ${pct(acc)} |  ${pct((accepted.length + rejected.length) / g.length)} |       ${pct(fa)} |       ${pct(fr)}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
