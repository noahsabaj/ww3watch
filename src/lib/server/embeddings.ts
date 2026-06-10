// Multilingual title embeddings for clustering (pipeline-side, Node only).
// Model runs locally on the Actions runner via Transformers.js — no API, no
// quota, deterministic. Same-story titles across languages (fa/ar/he/ru/zh/…)
// embed near each other; the assign_clusters_by_embedding RPC does the rest.
//
// Everything about the artifact is pinned: embeddings are only comparable
// within one (model, revision, dtype) vintage. Changing any of these requires
// a full re-backfill + threshold re-calibration (see scripts/calibrate-embeddings.ts,
// which MUST import this module rather than reimplementing it).

import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-base'
export const EMBEDDING_REVISION = '1ec9243030a27d1a115d5c340572074c125b58b2'
export const EMBEDDING_DTYPE = 'q8'
export const EMBEDDING_DIM = 768
export const EMBEDDING_MODEL_TAG = `me5b-${EMBEDDING_DTYPE}@${EMBEDDING_REVISION.slice(0, 7)}`

// Calibrated 2026-06-11 against the LLM-assigned clusters (e5-base run of
// scripts/calibrate-embeddings.ts): at 0.83, recall vs (noisy) LLM labels is
// ~39% with raw false-merge 3.4% — but the audited boundary band showed the
// "false merges" above ~0.82 are overwhelmingly same-story pairs the LLM
// failed to merge (en↔no Beirut strike, ar↔en Apache strikes, fa↔en oil
// jump), i.e. the improvement this project exists for. Genuine same-topic/
// different-event confusion lives below ~0.82. Env override is an emergency
// knob, passed through pipeline.yml.
// `||` not `??`: workflows pass unset secrets/vars as EMPTY strings, and
// Number('') === 0 would merge everything into one cluster.
export const EMBED_SIM_THRESHOLD = Number(process.env.EMBED_SIM_THRESHOLD || '0.83')
export const EMBED_WINDOW_HOURS = 8

// Survives npm ci (the library default is inside node_modules) and is the
// exact path the workflow's actions/cache step restores/saves.
export const EMBEDDINGS_CACHE_DIR =
  process.env.EMBEDDINGS_CACHE_DIR ?? join(homedir(), '.cache', 'ww3watch-transformers')

// Written only after a successful model init + smoke embed; the workflow's
// cache-save step is gated on it so a partial download never poisons the
// immutable cache key.
export const CACHE_SENTINEL = join(EMBEDDINGS_CACHE_DIR, `.ok-${EMBEDDING_MODEL_TAG}`)

// Zero-width chars + bidi controls + BOM — feed titles (especially RTL
// sources) carry these; they perturb tokenization without carrying meaning.
const BIDI_AND_ZW_MARKS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

export function preprocessTitle(title: string): string {
  return title.normalize('NFC').replace(BIDI_AND_ZW_MARKS, '').replace(/\s+/g, ' ').trim()
}

// Titles that must NOT be embedded: placeholder/empty/near-empty titles are
// identical or near-identical strings across feeds (rss.ts stamps a literal
// "(no title)") and would false-merge at similarity ~1.0. Skipped articles
// stay cluster_id=null; the client Jaccard fallback covers them.
export function shouldEmbed(title: string): boolean {
  const t = preprocessTitle(title)
  return t.length >= 15 && t !== '(no title)'
}

// e5 models require a task prefix; "query: " on BOTH sides is the documented
// form for symmetric similarity (the model card's clustering/similarity case).
function toInput(title: string): string {
  return `query: ${preprocessTitle(title)}`
}

export type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>

let extractorPromise: Promise<Extractor> | null = null

async function loadExtractor(): Promise<Extractor> {
  const { pipeline, env } = await import('@huggingface/transformers')
  // Must be set before the first from_pretrained call.
  env.cacheDir = EMBEDDINGS_CACHE_DIR
  const extractor = (await pipeline('feature-extraction', EMBEDDING_MODEL, {
    revision: EMBEDDING_REVISION,
    dtype: EMBEDDING_DTYPE,
  })) as unknown as Extractor

  // Smoke embed + dim assert, then drop the sentinel that authorizes the
  // workflow to save the model cache.
  const probe = (await extractor(['query: smoke test'], { pooling: 'mean', normalize: true })).tolist()
  if (probe.length !== 1 || probe[0].length !== EMBEDDING_DIM) {
    throw new Error(`[embeddings] smoke embed returned ${probe[0]?.length ?? 0} dims, expected ${EMBEDDING_DIM}`)
  }
  try {
    mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
    writeFileSync(CACHE_SENTINEL, new Date().toISOString())
  } catch {
    // Sentinel is a CI optimization — never fail embedding over it.
  }
  return extractor
}

const BATCH_SIZE = 32

// Embeds titles in batches. Caller is responsible for filtering with
// shouldEmbed() first — this function embeds whatever it's given.
// `extractorOverride` exists for tests; production always lazy-loads the real
// model exactly once per process.
export async function embedTitles(
  titles: string[],
  extractorOverride?: Extractor,
): Promise<number[][]> {
  if (titles.length === 0) return []
  const extractor = extractorOverride ?? (await (extractorPromise ??= loadExtractor()))
  const out: number[][] = []
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE).map(toInput)
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
    out.push(...tensor.tolist())
  }
  return out
}
