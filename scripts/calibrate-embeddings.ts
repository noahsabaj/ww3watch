// One-shot (re-runnable) embedding backfill + threshold calibration.
// Run via the "Calibrate embeddings" workflow_dispatch (secrets live there), or
// locally with SUPABASE_URL/SUPABASE_SECRET_KEY set:
//   node --import tsx scripts/calibrate-embeddings.ts
//
// Phase 1 backfills article_embeddings for every article missing one (touches
// NO cluster_id — history is never re-clustered; upserts are idempotent and
// safe alongside a live pipeline run).
//
// Phase 2 calibrates EMBED_SIM_THRESHOLD against the LLM-assigned clusters as
// ground truth, in the exact shape of the production decision (member ↔ its
// cluster REPRESENTATIVE, candidates restricted to an item-relative ±8h
// window), then prints: threshold sweep with false-merge vs recall, simulated
// assignment accuracy, per-language-pair distributions, and boundary-band
// pairs for manual review. The chosen constant gets committed in embeddings.ts.
//
// IMPORTANT: this script MUST embed through src/lib/server/embeddings.ts — a
// parallel implementation (different prefix/pooling/dtype/revision) would
// calibrate a threshold the pipeline never reproduces.

import { supabaseAdmin } from '../src/lib/server/supabase'
import {
  embedTitles,
  shouldEmbed,
  EMBEDDING_MODEL_TAG,
  EMBED_WINDOW_HOURS,
} from '../src/lib/server/embeddings'

const PAGE = 1000
const EMBED_CHUNK = 256
const UPSERT_CHUNK = 100
const WINDOW_MS = EMBED_WINDOW_HOURS * 60 * 60 * 1000

type Row = { id: string; title: string; cluster_id: string | null; source_lang: string; published_at: string | null }

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function pageAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
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

async function backfill(): Promise<void> {
  console.log(`\n=== PHASE 1: backfill (${EMBEDDING_MODEL_TAG}) ===`)
  const have = new Set(
    (
      await pageAll<{ article_id: string }>((f, t) =>
        supabaseAdmin.from('article_embeddings').select('article_id').range(f, t),
      )
    ).map((r) => r.article_id),
  )
  const articles = await pageAll<{ id: string; title: string }>((f, t) =>
    supabaseAdmin.from('articles').select('id, title').order('id').range(f, t),
  )
  const missing = articles.filter((a) => !have.has(a.id))
  const embeddable = missing.filter((a) => shouldEmbed(a.title))
  console.log(
    `articles ${articles.length} | already embedded ${have.size} | missing ${missing.length} | skipped (junk/short titles) ${missing.length - embeddable.length}`,
  )

  let written = 0
  const t0 = Date.now()
  for (let i = 0; i < embeddable.length; i += EMBED_CHUNK) {
    const chunk = embeddable.slice(i, i + EMBED_CHUNK)
    const vecs = await embedTitles(chunk.map((a) => a.title))
    const rows = chunk.map((a, j) => ({ article_id: a.id, embedding: vecs[j], model: EMBEDDING_MODEL_TAG }))
    for (let k = 0; k < rows.length; k += UPSERT_CHUNK) {
      const { error } = await supabaseAdmin
        .from('article_embeddings')
        .upsert(rows.slice(k, k + UPSERT_CHUNK), { onConflict: 'article_id' })
      if (error) throw new Error(`embedding upsert failed: ${JSON.stringify(error)}`)
    }
    written += rows.length
    console.log(`  ${written}/${embeddable.length} embedded (${Math.round((Date.now() - t0) / 1000)}s)`)
  }
  console.log(`backfill done: ${written} new embeddings in ${Math.round((Date.now() - t0) / 1000)}s`)
}

async function calibrate(): Promise<void> {
  console.log(`\n=== PHASE 2: calibration (window ±${EMBED_WINDOW_HOURS}h, production decision shape) ===`)

  const clustered = await pageAll<Row>((f, t) =>
    supabaseAdmin
      .from('articles')
      .select('id, title, cluster_id, source_lang, published_at')
      .not('cluster_id', 'is', null)
      .order('id')
      .range(f, t),
  )

  const vecs = new Map<string, number[]>()
  const ids = clustered.map((a) => a.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('article_embeddings')
      .select('article_id, embedding')
      .in('article_id', ids.slice(i, i + 200))
    if (error) throw new Error(`embedding fetch failed: ${JSON.stringify(error)}`)
    for (const r of data ?? []) {
      const v = typeof r.embedding === 'string' ? (JSON.parse(r.embedding) as number[]) : (r.embedding as number[])
      vecs.set(r.article_id, v)
    }
  }

  const clusters = new Map<string, Row[]>()
  for (const a of clustered) {
    const g = clusters.get(a.cluster_id!) ?? []
    g.push(a)
    clusters.set(a.cluster_id!, g)
  }
  // Representatives: id-as-text === cluster_id (the star-linkage convention).
  const reps = clustered.filter((a) => a.id === a.cluster_id && vecs.has(a.id) && a.published_at)
  const multi = [...clusters.values()].filter((g) => g.length >= 2)
  console.log(`clustered articles ${clustered.length} | clusters ${clusters.size} (multi-member ${multi.length}) | usable reps ${reps.length}`)

  type Pair = { sim: number; langA: string; langB: string; titleA: string; titleB: string; same: boolean }
  const positives: Pair[] = []
  const negatives: Pair[] = []

  for (const a of clustered) {
    const va = vecs.get(a.id)
    if (!va || !a.published_at || a.id === a.cluster_id) continue
    const ts = new Date(a.published_at).getTime()
    for (const rep of reps) {
      if (rep.id === a.id) continue
      if (Math.abs(new Date(rep.published_at!).getTime() - ts) > WINDOW_MS) continue
      const sim = dot(va, vecs.get(rep.id)!)
      const pair: Pair = {
        sim,
        langA: a.source_lang,
        langB: rep.source_lang,
        titleA: a.title,
        titleB: rep.title,
        same: rep.cluster_id === a.cluster_id,
      }
      if (pair.same) positives.push(pair)
      else negatives.push(pair)
    }
  }
  console.log(`pairs in window: positives (member↔own rep) ${positives.length} | hard negatives (member↔other rep) ${negatives.length}`)
  const crossPos = positives.filter((p) => p.langA !== p.langB)
  console.log(`cross-language positives: ${crossPos.length}`)

  // Threshold sweep — precision floor: false merges are the worse UI failure.
  console.log('\nthreshold | pos recall | false-merge rate (of negatives)')
  let suggested = NaN
  for (let t = 0.8; t <= 0.96; t += 0.005) {
    const recall = positives.filter((p) => p.sim >= t).length / Math.max(1, positives.length)
    const fm = negatives.filter((p) => p.sim >= t).length / Math.max(1, negatives.length)
    console.log(`  ${t.toFixed(3)}   | ${(recall * 100).toFixed(1).padStart(5)}%     | ${(fm * 100).toFixed(2)}%`)
    if (Number.isNaN(suggested) && fm <= 0.02) suggested = t
  }
  console.log(`\nSUGGESTED (lowest t with false-merge ≤ 2%): ${Number.isNaN(suggested) ? 'NONE in range' : suggested.toFixed(3)}`)

  // Simulated assignment: would embedding argmax pick the LLM's cluster?
  let simTotal = 0
  let simCorrect = 0
  const margins: number[] = []
  const perLang = new Map<string, { total: number; correct: number; sims: number[] }>()
  for (const a of clustered) {
    const va = vecs.get(a.id)
    if (!va || !a.published_at || a.id === a.cluster_id) continue
    const ts = new Date(a.published_at).getTime()
    const cands = reps.filter((r) => r.id !== a.id && Math.abs(new Date(r.published_at!).getTime() - ts) <= WINDOW_MS)
    if (!cands.some((r) => r.cluster_id === a.cluster_id)) continue // own rep outside window
    const ranked = cands.map((r) => ({ r, sim: dot(va, vecs.get(r.id)!) })).sort((x, y) => y.sim - x.sim)
    simTotal++
    const correct = ranked[0].r.cluster_id === a.cluster_id
    if (correct) simCorrect++
    if (ranked.length > 1) margins.push(ranked[0].sim - ranked[1].sim)
    const own = reps.find((r) => r.cluster_id === a.cluster_id)!
    const key = [a.source_lang, own.source_lang].sort().join('-')
    const bucket = perLang.get(key) ?? { total: 0, correct: 0, sims: [] }
    bucket.total++
    if (correct) bucket.correct++
    bucket.sims.push(dot(va, vecs.get(own.id)!))
    perLang.set(key, bucket)
  }
  console.log(`\nsimulated assignment: top-1 agreement with LLM ${simCorrect}/${simTotal} (${((simCorrect / Math.max(1, simTotal)) * 100).toFixed(1)}%)`)
  console.log(`top1-top2 margin: p10 ${pct(margins, 10).toFixed(3)} | p50 ${pct(margins, 50).toFixed(3)}`)

  console.log('\nper language-pair (member↔own-rep sims; buckets <20 are noisy):')
  const sameL: number[] = []
  const crossL: number[] = []
  for (const [key, b] of [...perLang.entries()].sort((x, y) => y[1].total - x[1].total)) {
    const [l1, l2] = key.split('-')
    ;(l1 === l2 ? sameL : crossL).push(...b.sims)
    if (b.total >= 20)
      console.log(`  ${key.padEnd(7)} n=${String(b.total).padStart(3)} | agree ${((b.correct / b.total) * 100).toFixed(0).padStart(3)}% | sim p10 ${pct(b.sims, 10).toFixed(3)} p50 ${pct(b.sims, 50).toFixed(3)}`)
  }
  console.log(`  SAME-LANG  n=${sameL.length}: p10 ${pct(sameL, 10).toFixed(3)} p50 ${pct(sameL, 50).toFixed(3)}`)
  console.log(`  CROSS-LANG n=${crossL.length}: p10 ${pct(crossL, 10).toFixed(3)} p50 ${pct(crossL, 50).toFixed(3)}`)

  // Boundary band for manual review, cross-lingual first.
  const band = Number.isNaN(suggested) ? 0.87 : suggested
  const inBand = [...positives, ...negatives]
    .filter((p) => Math.abs(p.sim - band) <= 0.03)
    .sort((a, b) => Number(b.langA !== b.langB) - Number(a.langA !== a.langB) || b.sim - a.sim)
    .slice(0, 40)
  console.log(`\nboundary band (${(band - 0.03).toFixed(3)}–${(band + 0.03).toFixed(3)}), ${inBand.length} pairs — eyeball these:`)
  for (const p of inBand) {
    console.log(`  ${p.sim.toFixed(3)} ${p.same ? 'SAME' : 'DIFF'} [${p.langA}→${p.langB}] ${p.titleA.slice(0, 70)} ↔ ${p.titleB.slice(0, 70)}`)
  }
}

async function main() {
  await backfill()
  await calibrate()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[calibrate] fatal:', err)
    process.exit(1)
  })
