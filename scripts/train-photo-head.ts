// Trains the photo head (src/lib/server/pipeline/photo-head.ts) on the hand
// labels in data/photo-labels.jsonl and writes data/photo-head.json.
//
//   node --import tsx scripts/train-photo-head.ts [--photo-min 0.5] [--c 30]
//
// WHAT: L2-regularised logistic regression over the stored CLIP embeddings,
// photographs against everything else, each class weighted to count equally.
// The same objective as scikit-learn's LogisticRegression(C, class_weight=
// 'balanced'), solved by accelerated gradient descent. Trained on the first
// 1,020 labels, it agreed with scikit-learn to within 0.003 on all 4,584
// pictures of the two days to 2026-09-24, with no verdict different.
//
// photo_min is policy, not fitted: kept from the current head unless given.
// Five-fold cross-validation is printed and stored in the head, so a retrain
// that got worse shows in the diff.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  PHOTO_EMBEDDING_DIM,
  PHOTO_HEAD_PATH,
  PHOTO_LABELS_PATH,
  PHOTO_TAG,
  photoProbability,
  unpackEmbedding,
  validatePhotoHead,
  type PhotoHead,
  type PhotoLabel,
} from '../src/lib/server/pipeline/photo-head'

const MIN_PER_CLASS = 150
const MIN_CV_AUC = 0.9
const ITERATIONS = 4000
const FOLDS = 5
const SEED = 20260924

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type Model = { weights: number[]; bias: number }

// Minimises (1/N) Σ c_i·logloss_i + ||w||² / (2·C·N), c_i balancing the classes.
function train(X: number[][], y: number[], C: number): Model {
  const n = X.length
  const d = X[0].length
  const nPos = y.reduce((s, v) => s + v, 0)
  const cw = y.map((v) => (v ? n / (2 * nPos) : n / (2 * (n - nPos))))
  const lambda = 1 / (C * n)
  // Step size from the largest eigenvalue of the weighted Gram matrix (power iteration).
  let v = new Float64Array(d + 1).fill(1 / Math.sqrt(d + 1))
  let eig = 0
  for (let it = 0; it < 30; it++) {
    const next = new Float64Array(d + 1)
    for (let i = 0; i < n; i++) {
      let dot = v[d]
      const x = X[i]
      for (let j = 0; j < d; j++) dot += x[j] * v[j]
      const s = cw[i] * dot
      for (let j = 0; j < d; j++) next[j] += s * x[j]
      next[d] += s
    }
    let norm = 0
    for (let j = 0; j <= d; j++) norm += next[j] * next[j]
    norm = Math.sqrt(norm)
    eig = norm
    for (let j = 0; j <= d; j++) next[j] /= norm
    v = next
  }
  const L = eig / (4 * n) + lambda
  const step = 1 / L
  let w = new Float64Array(d + 1)
  let prev = new Float64Array(d + 1)
  for (let it = 1; it <= ITERATIONS; it++) {
    const momentum = (it - 1) / (it + 2)
    const look = new Float64Array(d + 1)
    for (let j = 0; j <= d; j++) look[j] = w[j] + momentum * (w[j] - prev[j])
    const grad = new Float64Array(d + 1)
    for (let i = 0; i < n; i++) {
      const x = X[i]
      let z = look[d]
      for (let j = 0; j < d; j++) z += x[j] * look[j]
      const r = (cw[i] * (1 / (1 + Math.exp(-z)) - y[i])) / n
      for (let j = 0; j < d; j++) grad[j] += r * x[j]
      grad[d] += r
    }
    for (let j = 0; j < d; j++) grad[j] += lambda * look[j]
    prev = w
    w = new Float64Array(d + 1)
    for (let j = 0; j <= d; j++) w[j] = look[j] - step * grad[j]
  }
  return { weights: Array.from(w.subarray(0, d)), bias: w[d] }
}

function auc(scores: number[], y: number[]): number {
  const order = scores.map((s, i) => [s, y[i]] as const).sort((a, b) => a[0] - b[0])
  let rankSum = 0
  let nPos = 0
  order.forEach(([, label], i) => {
    if (label) {
      rankSum += i + 1
      nPos++
    }
  })
  const nNeg = order.length - nPos
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)
}

// A small deterministic PRNG, so folds are the same on every run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function crossValidate(X: number[][], y: number[], C: number, photoMin: number) {
  const rand = mulberry32(SEED)
  const fold = new Array<number>(y.length)
  for (const cls of [0, 1]) {
    const idx = y.map((v, i) => (v === cls ? i : -1)).filter((i) => i >= 0)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    idx.forEach((i, k) => (fold[i] = k % FOLDS))
  }
  const scores = new Array<number>(y.length)
  for (let f = 0; f < FOLDS; f++) {
    const tr = y.map((_, i) => i).filter((i) => fold[i] !== f)
    const model = train(tr.map((i) => X[i]), tr.map((i) => y[i]), C)
    y.forEach((_, i) => {
      if (fold[i] === f) scores[i] = photoProbability(model, X[i])
    })
  }
  const photos = y.filter((v) => v === 1).length
  return {
    folds: FOLDS,
    auc: Math.round(auc(scores, y) * 10000) / 10000,
    photo_min: photoMin,
    photos,
    photos_hidden: y.filter((v, i) => v === 1 && scores[i] < photoMin).length,
    graphics: y.length - photos,
    graphics_shown: y.filter((v, i) => v === 0 && scores[i] >= photoMin).length,
  }
}

function main() {
  const labels = readFileSync(PHOTO_LABELS_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PhotoLabel)
  const usable = labels.filter((l) => l.tag === PHOTO_TAG)
  if (usable.length < labels.length) console.warn(`[train-photo-head] ${labels.length - usable.length} labels embedded with another model or views were skipped`)
  const X = usable.map((l) => unpackEmbedding(l.emb))
  if (X.some((x) => x.length !== PHOTO_EMBEDDING_DIM)) throw new Error('an embedding has the wrong length')
  const y = usable.map((l) => (l.photo ? 1 : 0))
  const nPhoto = y.filter((v) => v === 1).length
  const nOther = y.length - nPhoto
  if (nPhoto < MIN_PER_CLASS || nOther < MIN_PER_CLASS) throw new Error(`too few labels: ${nPhoto} photographs, ${nOther} others (want ${MIN_PER_CLASS} each)`)

  const current = existsSync(PHOTO_HEAD_PATH) ? (JSON.parse(readFileSync(PHOTO_HEAD_PATH, 'utf8')) as PhotoHead) : null
  const photoMin = Number(arg('--photo-min') ?? current?.photo_min ?? 0.5)
  const C = Number(arg('--c') ?? 30)

  const cv = crossValidate(X, y, C, photoMin)
  console.log(`[train-photo-head] ${nPhoto} photographs, ${nOther} others; ${FOLDS}-fold CV: AUC ${cv.auc}, at photo_min ${photoMin} ${cv.photos_hidden}/${cv.photos} photographs hidden, ${cv.graphics_shown}/${cv.graphics} others shown`)
  if (cv.auc < MIN_CV_AUC) throw new Error(`CV AUC ${cv.auc} below ${MIN_CV_AUC}: not writing the head`)

  const model = train(X, y, C)
  const head: PhotoHead = {
    tag: PHOTO_TAG,
    trained_at: new Date().toISOString(),
    n_photo: nPhoto,
    n_other: nOther,
    weights: model.weights.map((w) => Math.round(w * 1e6) / 1e6),
    bias: Math.round(model.bias * 1e6) / 1e6,
    photo_min: photoMin,
    cv: { ...cv, c: C },
  }
  const problems = validatePhotoHead(head)
  if (problems.length) throw new Error(problems.join('; '))
  writeFileSync(PHOTO_HEAD_PATH, JSON.stringify(head) + '\n')
  console.log(`[train-photo-head] wrote ${PHOTO_HEAD_PATH}`)
}

main()
