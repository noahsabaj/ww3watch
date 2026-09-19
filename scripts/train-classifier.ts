// Trains the local relevance head (src/lib/server/prefilter.ts) and writes
// data/classifier-me5b.json. Runs monthly via train-classifier.yml, or:
//   gh workflow run train-classifier.yml
//   node --import tsx scripts/train-classifier.ts   (needs SUPABASE_SECRET_KEY)
//
// WHAT: logistic regression over the pipeline's own e5 title embeddings,
// positives = accepted articles, negatives = rejects by an independent model
// (reason 'jev', or historical 'llm' — never 'stale' rows nobody judged, never
// the head's own 'head' rejects, which would teach it its own mistakes). Jev is
// the pipeline's relevance judge and writes every new judged reject; 'llm' rows
// are left over from the retired LLM tier and age out of classified_rejects
// after 14 days. Jev's verdicts are the label source, so this is a
// distillation: the head learns to reproduce Jev on the easy mass of the
// distribution and hands the rest back to it.
//
// THRESHOLDS are chosen on a held-out split, never on training data:
//   reject_below — the highest score at which the false-reject rate on held-out
//                  positives stays ≤ MAX_FALSE_REJECT overall AND per language
//                  (a language with ≥ MIN_LANG_N holdout positives). The centroid
//                  shadow pre-filter showed the English-dominated average hides
//                  a harsher bar on Persian/Russian; the per-language cap is what
//                  stops that.
//   accept_above — the lowest score at which the false-accept rate on held-out
//                  negatives stays ≤ MAX_FALSE_ACCEPT.
// GUARDRAILS: the file is not written when the bands overlap, when too little
// of the holdout leaves the uncertain band to be worth it, or when the label
// pool is too small. A failed fit fails the job; it never ships.
//
// Embeds through src/lib/server/embeddings.ts — the exact vintage the pipeline
// scores with. The weights carry that model tag and are refused on mismatch.

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { embedTitles, shouldEmbed, EMBEDDING_MODEL_TAG, EMBEDDING_DIM } from '../src/lib/server/embeddings'
import { HEAD_PATH, validateHead, type ClassifierHead } from '../src/lib/server/prefilter'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error('need SUPABASE_URL + SUPABASE_SECRET_KEY (classified_rejects is service-only)')
}
const supabase = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } })

const PAGE = 1000
const EMBED_CHUNK = 512
const HOLDOUT_FRACTION = 0.15
const SEED = 20260914
const EPOCHS = 60
const BATCH = 256
const LR0 = 0.5
const L2 = 1e-4

const MAX_FALSE_REJECT = 0.02
const MAX_FALSE_ACCEPT = 0.02
const MAX_LANG_FALSE_REJECT = 0.05
const MIN_LANG_N = 50
const MIN_CLASS_N = 2000
// Below this share of the holdout leaving the uncertain band, the head isn't
// saving enough Jev calls to be worth the routing complexity.
const MIN_RESOLVED_FRACTION = 0.3

type Row = { title: string; lang: string; y: 0 | 1 }

// Deterministic PRNG (mulberry32) so the split is reproducible run to run.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Paged reads with retry: PostgREST answers a slow page with a bare
// "Gateway Timeout" now and then (it did on the first training run), and a
// 30-second job should not die on one of thirty pages.
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    let data: T[] | null = null
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await query(from, from + PAGE - 1)
      if (!res.error) { data = res.data; lastError = null; break }
      lastError = res.error
      console.warn(`  page ${from}: ${JSON.stringify(res.error)} (attempt ${attempt})`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
    if (lastError) throw new Error(`page query failed: ${JSON.stringify(lastError)}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function embedAll(rows: Row[], label: string): Promise<number[][]> {
  const out: number[][] = []
  const t0 = Date.now()
  for (let i = 0; i < rows.length; i += EMBED_CHUNK) {
    const chunk = rows.slice(i, i + EMBED_CHUNK)
    out.push(...(await embedTitles(chunk.map((r) => r.title))))
    console.log(`  [${label}] embedded ${Math.min(i + EMBED_CHUNK, rows.length)}/${rows.length} (${Math.round((Date.now() - t0) / 1000)}s)`)
  }
  return out
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

function train(X: number[][], y: number[], random: () => number): { w: number[]; b: number } {
  const n = X.length
  const d = X[0].length
  const w = new Array<number>(d).fill(0)
  let b = 0
  // Class weights: the pool is ~2:1 negative; balance so the bias isn't just
  // the prior and the score is comparable across the two thresholds.
  const nPos = y.reduce((s, v) => s + v, 0)
  const wPos = n / (2 * nPos)
  const wNeg = n / (2 * (n - nPos))
  const idx = [...Array(n).keys()]
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const lr = LR0 * Math.pow(0.95, epoch)
    // Fisher–Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    for (let s = 0; s < n; s += BATCH) {
      const gw = new Array<number>(d).fill(0)
      let gb = 0
      const end = Math.min(n, s + BATCH)
      for (let k = s; k < end; k++) {
        const i = idx[k]
        const x = X[i]
        let z = b
        for (let j = 0; j < d; j++) z += w[j] * x[j]
        const err = (sigmoid(z) - y[i]) * (y[i] === 1 ? wPos : wNeg)
        for (let j = 0; j < d; j++) gw[j] += err * x[j]
        gb += err
      }
      const m = end - s
      for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / m + L2 * w[j])
      b -= lr * (gb / m)
    }
  }
  return { w, b }
}

function score(w: number[], b: number, x: number[]): number {
  let z = b
  for (let j = 0; j < w.length; j++) z += w[j] * x[j]
  return sigmoid(z)
}

const fmt = (x: number) => (x * 100).toFixed(2) + '%'

async function main() {
  console.log(`=== train-classifier (${EMBEDDING_MODEL_TAG}) ===`)

  const positives = await pageAll<{ title: string; source_lang: string }>((f, t) =>
    supabase.from('articles').select('title, source_lang').order('id').range(f, t),
  )
  const negatives = await pageAll<{ title: string | null; lang: string | null }>((f, t) =>
    supabase.from('classified_rejects').select('title, lang').in('reason', ['llm', 'jev']).order('rejected_at').order('guid').range(f, t),
  )
  // Dedupe by title: wire copies would otherwise let one headline vote many times.
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const p of positives) {
    if (!shouldEmbed(p.title) || seen.has(p.title)) continue
    seen.add(p.title)
    rows.push({ title: p.title, lang: p.source_lang ?? '?', y: 1 })
  }
  for (const r of negatives) {
    if (!r.title || !shouldEmbed(r.title) || seen.has(r.title)) continue
    seen.add(r.title)
    rows.push({ title: r.title, lang: r.lang ?? '?', y: 0 })
  }
  const nPos = rows.filter((r) => r.y === 1).length
  const nNeg = rows.length - nPos
  console.log(`labels: ${nPos} positives, ${nNeg} negatives (deduped)`)
  if (nPos < MIN_CLASS_N || nNeg < MIN_CLASS_N) {
    throw new Error(`too few labels (need ≥${MIN_CLASS_N} per class)`)
  }

  // Stratified split, seeded.
  const random = rng(SEED)
  const trainRows: Row[] = []
  const holdRows: Row[] = []
  for (const r of rows) (random() < HOLDOUT_FRACTION ? holdRows : trainRows).push(r)

  const Xtr = await embedAll(trainRows, 'train')
  const Xho = await embedAll(holdRows, 'holdout')
  if (Xtr[0].length !== EMBEDDING_DIM) throw new Error(`embedding dim ${Xtr[0].length} != ${EMBEDDING_DIM}`)

  console.log(`training on ${trainRows.length}, holding out ${holdRows.length}`)
  const { w, b } = train(Xtr, trainRows.map((r) => r.y), random)

  const hs = holdRows.map((r, i) => ({ ...r, s: score(w, b, Xho[i]) }))
  const pos = hs.filter((r) => r.y === 1)
  const neg = hs.filter((r) => r.y === 0)
  const posScores = pos.map((r) => r.s).sort((a, c) => a - c)
  const negScores = neg.map((r) => r.s).sort((a, c) => a - c)
  const fracBelow = (sorted: number[], t: number) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid }
    return lo / sorted.length
  }
  const fracAbove = (sorted: number[], t: number) => 1 - fracBelow(sorted, t) - sorted.filter((x) => x === t).length / sorted.length

  // Per-language holdout positives (for the per-language false-reject cap).
  const byLang = new Map<string, number[]>()
  for (const r of pos) byLang.set(r.lang, [...(byLang.get(r.lang) ?? []), r.s])
  for (const v of byLang.values()) v.sort((a, c) => a - c)

  // Sweep a fine grid of thresholds.
  const grid: number[] = []
  for (let t = 0.005; t < 1; t += 0.005) grid.push(+t.toFixed(3))
  let rejectBelow = 0
  for (const t of grid) {
    if (fracBelow(posScores, t) > MAX_FALSE_REJECT) break
    let langOk = true
    for (const [, v] of byLang) if (v.length >= MIN_LANG_N && fracBelow(v, t) > MAX_LANG_FALSE_REJECT) langOk = false
    if (!langOk) break
    rejectBelow = t
  }
  let acceptAbove = 1
  for (const t of [...grid].reverse()) {
    if (fracAbove(negScores, t) > MAX_FALSE_ACCEPT) break
    acceptAbove = t
  }

  const autoRejected = fracBelow(negScores, rejectBelow)
  const autoAccepted = fracAbove(posScores, acceptAbove)
  const resolved = hs.filter((r) => r.s < rejectBelow || r.s > acceptAbove).length / hs.length
  const accuracy = hs.filter((r) => (r.s >= 0.5) === (r.y === 1)).length / hs.length
  const langTable = [...byLang.entries()]
    .filter(([, v]) => v.length >= MIN_LANG_N)
    .map(([lang, v]) => ({ lang, n: v.length, false_reject: +fracBelow(v, rejectBelow).toFixed(4) }))
    .sort((a, c) => c.n - a.n)

  const holdout = {
    n_pos: pos.length,
    n_neg: neg.length,
    accuracy_at_half: +accuracy.toFixed(4),
    false_reject_at_floor: +fracBelow(posScores, rejectBelow).toFixed(4),
    negatives_auto_rejected: +autoRejected.toFixed(4),
    false_accept_at_ceiling: +fracAbove(negScores, acceptAbove).toFixed(4),
    positives_auto_accepted: +autoAccepted.toFixed(4),
    resolved_fraction: +resolved.toFixed(4),
    per_language_false_reject: langTable,
  }

  const summary = [
    `## Relevance head — ${EMBEDDING_MODEL_TAG}`,
    `labels: ${nPos} pos / ${nNeg} neg · holdout ${hs.length}`,
    `accuracy@0.5 ${fmt(accuracy)}`,
    `reject_below **${rejectBelow}** → false-reject ${fmt(holdout.false_reject_at_floor)}, auto-rejects ${fmt(autoRejected)} of negatives`,
    `accept_above **${acceptAbove}** → false-accept ${fmt(holdout.false_accept_at_ceiling)}, auto-accepts ${fmt(autoAccepted)} of positives`,
    `resolved without Jev: **${fmt(resolved)}** of holdout`,
    '',
    '| lang | holdout pos | false-reject @ floor |',
    '|---|---|---|',
    ...langTable.map((r) => `| ${r.lang} | ${r.n} | ${fmt(r.false_reject)} |`),
  ].join('\n')
  console.log('\n' + summary + '\n')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')

  // Guardrails — a fit that can't buy its keep is not shipped.
  if (rejectBelow >= acceptAbove) throw new Error(`bands overlap: reject_below ${rejectBelow} >= accept_above ${acceptAbove}`)
  if (resolved < MIN_RESOLVED_FRACTION) {
    throw new Error(`only ${fmt(resolved)} of holdout resolved without Jev (need ≥ ${fmt(MIN_RESOLVED_FRACTION)}) — not shipping`)
  }

  const head: ClassifierHead = {
    model_tag: EMBEDDING_MODEL_TAG,
    trained_at: new Date().toISOString(),
    n_pos: nPos,
    n_neg: nNeg,
    weights: w.map((x) => +x.toFixed(6)),
    bias: +b.toFixed(6),
    reject_below: rejectBelow,
    accept_above: acceptAbove,
    holdout,
  }
  const problems = validateHead(head)
  if (problems.length) throw new Error(`head failed validation: ${problems.join('; ')}`)
  mkdirSync('data', { recursive: true })
  writeFileSync(HEAD_PATH, JSON.stringify(head, null, 1) + '\n')
  console.log(`[train] wrote ${HEAD_PATH}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[train] fatal:', err)
    process.exit(1)
  })
