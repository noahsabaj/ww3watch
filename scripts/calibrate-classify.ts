// Calibration for the classification embedding PRE-FILTER (auto-reject floor).
// Runs via the "Run script" workflow_dispatch (secrets live there):
//   gh workflow run run-script.yml -f script=scripts/calibrate-classify.ts
// or locally with SUPABASE_URL/SUPABASE_SECRET_KEY:
//   node --import tsx scripts/calibrate-classify.ts
//
// WHY: since 2026-06-11 the pipeline runs a SHADOW pre-filter — it embeds each
// LLM-classified title and scores cosine similarity against the normalized
// 14-day accepted-articles centroid (relevant_centroid RPC), logging aggregates
// to pipeline_runs.stats.cls_prefilter. This script computes the EXACT
// distributions (not per-run percentiles) over a week of accumulated data, to
// decide whether to promote the shadow into a real AUTO-REJECT: candidate
// titles scoring below CLS_REJECT_FLOOR skip the LLM and go straight to the
// reject set.
//
// DECISION INPUTS this prints:
//   - per-class percentile tables (the false-reject cost lives in the positive
//     low tail; the benefit lives in the negative low tail),
//   - a floor sweep R in 0.78–0.86: false-reject rate (positives < R) vs volume
//     of negatives auto-rejected (negatives < R),
//   - per-LANGUAGE false-reject at candidate floors — the centroid is
//     English-dominated, so a single global floor imposes a harsher relevance
//     bar on non-English sources; this must be surfaced, never hidden in the
//     English-dominated average,
//   - the 30 lowest-scoring positives (the audit band) — eyeball whether
//     they're genuinely conflict-relevant or themselves LLM mistakes
//     (sports/entertainment leakage is a WIN for the filter, not an error).
//
// IMPORTANT: embeds through src/lib/server/embeddings.ts — never a parallel
// implementation. A different prefix/pooling/dtype/revision would calibrate a
// floor the pipeline never reproduces. Read-only: this script writes nothing.

import { createClient } from '@supabase/supabase-js'
import { embedTitles, shouldEmbed, EMBEDDING_MODEL_TAG } from '../src/lib/server/embeddings'

// classified_rejects is RLS service-only (zero policies) — unlike
// calibrate-embeddings, the publishable key cannot read the negatives, so the
// secret key is REQUIRED.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error('need SUPABASE_URL + SUPABASE_SECRET_KEY (classified_rejects is service-only)')
}
const supabase = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } })

const SINCE = '2026-06-11'
const CENTROID_DAYS = 14
const PAGE = 1000
const EMBED_CHUNK = 512
// The decision grid. Floors below ~0.78 reject almost nothing; above ~0.86 they
// false-reject swathes of real articles. The conservative rule lives in here.
const SWEEP: number[] = []
for (let r = 0.78; r <= 0.8601; r += 0.005) SWEEP.push(+r.toFixed(3))
// Candidate floors at which to break false-reject down by language.
const LANG_FLOORS = [0.79, 0.795, 0.8, 0.81]

type Scored = { title: string; lang: string; sim: number }

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// Linear-interpolated percentile over an ASC-sorted array (matches Postgres
// percentile_cont, used for the SQL cross-check).
function pct(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return NaN
  if (n === 1) return sortedAsc[0]
  const idx = (p / 100) * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(`page query failed: ${JSON.stringify(error)}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function scoreAll(rows: Array<{ title: string; lang: string }>, unit: number[], label: string): Promise<Scored[]> {
  const out: Scored[] = []
  const t0 = Date.now()
  for (let i = 0; i < rows.length; i += EMBED_CHUNK) {
    const chunk = rows.slice(i, i + EMBED_CHUNK)
    const vecs = await embedTitles(chunk.map((r) => r.title))
    chunk.forEach((r, j) => out.push({ title: r.title, lang: r.lang, sim: dot(vecs[j], unit) }))
    console.log(`  [${label}] embedded ${Math.min(i + EMBED_CHUNK, rows.length)}/${rows.length} (${Math.round((Date.now() - t0) / 1000)}s)`)
  }
  return out
}

function percentileTable(label: string, scored: Scored[]) {
  const s = scored.map((x) => x.sim).sort((a, b) => a - b)
  const cols: Array<[string, number]> = [
    ['min', 0],
    ['p0.5', 0.5],
    ['p1', 1],
    ['p2', 2],
    ['p5', 5],
    ['p10', 10],
    ['p25', 25],
    ['p50', 50],
    ['p75', 75],
    ['p90', 90],
  ]
  console.log(`\n${label} (n=${s.length})`)
  console.log('  ' + cols.map(([name]) => name.padStart(7)).join(' '))
  console.log('  ' + cols.map(([, p]) => pct(s, p).toFixed(4).padStart(7)).join(' '))
}

async function main() {
  console.log(`=== calibrate-classify (${EMBEDDING_MODEL_TAG}, centroid ${CENTROID_DAYS}d, since ${SINCE}) ===`)

  // 1. Centroid: avg() of unit vectors is not unit-length — normalize for cosine
  //    (exactly as the shadow path does in run-pipeline.ts).
  const { data: rawCen, error: cenErr } = await supabase.rpc('relevant_centroid', { p_days: CENTROID_DAYS })
  if (cenErr || !rawCen) throw new Error(`relevant_centroid failed: ${JSON.stringify(cenErr)}`)
  const centroid = (typeof rawCen === 'string' ? JSON.parse(rawCen) : rawCen) as number[]
  const norm = Math.sqrt(centroid.reduce((acc, x) => acc + x * x, 0))
  if (!norm) throw new Error('centroid has zero norm')
  const unit = centroid.map((x) => x / norm)
  console.log(`centroid dims=${centroid.length} (normalized)`)

  // 2. Load positives (accepted articles) and negatives (LLM rejects with a title).
  const positives = await pageAll<{ title: string; source_lang: string }>((f, t) =>
    supabase.from('articles').select('title, source_lang').gte('fetched_at', SINCE).order('id').range(f, t),
  )
  const negatives = await pageAll<{ title: string; lang: string }>((f, t) =>
    supabase
      .from('classified_rejects')
      .select('title, lang')
      .not('title', 'is', null)
      .gte('rejected_at', SINCE)
      .order('guid')
      .range(f, t),
  )
  console.log(`loaded: positives ${positives.length} | negatives ${negatives.length}`)

  // 3. The pre-filter only acts on shouldEmbed titles; non-embeddable candidates
  //    bypass it entirely (straight to the LLM). So the cost/benefit is measured
  //    over the embeddable subset only.
  const posRows = positives.filter((a) => shouldEmbed(a.title)).map((a) => ({ title: a.title, lang: a.source_lang ?? '??' }))
  const negRows = negatives.filter((a) => shouldEmbed(a.title)).map((a) => ({ title: a.title, lang: a.lang ?? '??' }))
  console.log(
    `embeddable: positives ${posRows.length} (skipped ${positives.length - posRows.length}) | ` +
      `negatives ${negRows.length} (skipped ${negatives.length - negRows.length})`,
  )

  const pos = await scoreAll(posRows, unit, 'pos')
  const neg = await scoreAll(negRows, unit, 'neg')

  // 4. Per-class percentile tables.
  percentileTable('POSITIVES (accepted — false-reject cost lives in the low tail)', pos)
  percentileTable('NEGATIVES (LLM rejects — benefit lives in the low tail)', neg)

  // 5. Floor sweep: false-reject rate vs negatives caught.
  const posSims = pos.map((x) => x.sim)
  const negSims = neg.map((x) => x.sim)
  console.log('\nFLOOR SWEEP')
  console.log('   R     | false-reject (pos<R)      | negatives auto-rejected (neg<R)')
  for (const R of SWEEP) {
    const fr = posSims.filter((s) => s < R).length
    const nr = negSims.filter((s) => s < R).length
    const frPct = (100 * fr) / Math.max(1, posSims.length)
    const nrPct = (100 * nr) / Math.max(1, negSims.length)
    const flag = frPct <= 0.5 ? ' ' : '!'
    console.log(
      `  ${R.toFixed(3)} ${flag}| ${String(fr).padStart(4)} (${frPct.toFixed(2).padStart(5)}%)        | ${String(nr).padStart(5)} (${nrPct.toFixed(1).padStart(4)}%)`,
    )
  }

  // 6. THE CRUX — per-language false-reject at candidate floors. A global floor
  //    tuned to ~0.5% overall can hide a much harsher bar on non-English sources.
  const langs = [...new Set(pos.map((x) => x.lang))]
    .map((l) => ({ lang: l, sims: pos.filter((x) => x.lang === l).map((x) => x.sim).sort((a, b) => a - b) }))
    .filter((x) => x.sims.length >= 20)
    .sort((a, b) => pct(a.sims, 50) - pct(b.sims, 50))
  console.log('\nPER-LANGUAGE POSITIVE FALSE-REJECT (lang | n | p1 | p5 | p10 | p50 | false-reject% at floors)')
  for (const { lang, sims } of langs) {
    const fr = LANG_FLOORS.map((R) => `${R}:${((100 * sims.filter((s) => s < R).length) / sims.length).toFixed(1)}%`).join('  ')
    console.log(
      `  ${lang.padEnd(4)} n=${String(sims.length).padStart(4)} | p1 ${pct(sims, 1).toFixed(3)} p5 ${pct(sims, 5).toFixed(3)} p10 ${pct(sims, 10).toFixed(3)} p50 ${pct(sims, 50).toFixed(3)} | ${fr}`,
    )
  }

  // For completeness: where do the negatives sit per language (benefit by lang)?
  const negLangs = [...new Set(neg.map((x) => x.lang))]
    .map((l) => ({ lang: l, sims: neg.filter((x) => x.lang === l).map((x) => x.sim).sort((a, b) => a - b) }))
    .filter((x) => x.sims.length >= 20)
    .sort((a, b) => b.sims.length - a.sims.length)
  console.log('\nPER-LANGUAGE NEGATIVE volume caught (lang | n | negatives<R%)')
  for (const { lang, sims } of negLangs) {
    const nr = LANG_FLOORS.map((R) => `${R}:${((100 * sims.filter((s) => s < R).length) / sims.length).toFixed(1)}%`).join('  ')
    console.log(`  ${lang.padEnd(4)} n=${String(sims.length).padStart(5)} | ${nr}`)
  }

  // 7. Audit band: the 30 lowest-scoring positives. Are these LLM noise (filter
  //    wins) or genuine conflict news the floor would silently drop forever?
  console.log('\nAUDIT BAND — 30 LOWEST-SCORING POSITIVES (accepted articles):')
  for (const x of [...pos].sort((a, b) => a.sim - b.sim).slice(0, 30)) {
    console.log(`  ${x.sim.toFixed(4)} [${x.lang.padEnd(3)}] ${x.title.slice(0, 90)}`)
  }

  // 8. Headline: max floor at <=0.5% overall false-reject, and what it costs/buys.
  const sortedPos = [...posSims].sort((a, b) => a - b)
  const maxR = pct(sortedPos, 0.5) // the floor at exactly 0.5% overall false-reject
  const negAtMaxR = (100 * negSims.filter((s) => s < maxR).length) / Math.max(1, negSims.length)
  console.log(
    `\nSUMMARY: max floor at <=0.5% OVERALL false-reject ~= ${maxR.toFixed(4)} ` +
      `-> would auto-reject ${negAtMaxR.toFixed(1)}% of negatives. ` +
      `Check the per-language table above before trusting the overall rate.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[calibrate-classify] fatal:', err)
    process.exit(1)
  })
