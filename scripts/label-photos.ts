// Label pictures for the photo head: the fix for the next logo, card or map
// that reaches the site, and for a photograph wrongly hidden.
//
//   node --env-file=.env --import tsx scripts/label-photos.ts graphic <article id or image URL>...
//   node --env-file=.env --import tsx scripts/label-photos.ts photo   <article id or image URL>...
//
// Each picture is downloaded, embedded exactly as the pipeline embeds it
// (photo-embed.ts) and added to data/photo-labels.jsonl, replacing an earlier
// label for the same article or URL. Then retrain and ship:
//
//   node --import tsx scripts/train-photo-head.ts
//   (after merge) gh workflow run run-script.yml -f script=scripts/recheck-photos.ts
//
// Reads articles with the site's public key; writes nothing to the database.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { photoEmbedder } from '../src/lib/server/pipeline/photo-embed'
import { PHOTO_LABELS_PATH, PHOTO_TAG, packEmbedding, type PhotoLabel } from '../src/lib/server/pipeline/photo-head'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

async function imageUrlOf(articleId: string): Promise<string> {
  const base = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) throw new Error('need PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)')
  const res = await fetch(`${base}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&select=image_url`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`article ${articleId}: HTTP ${res.status}`)
  const rows = (await res.json()) as Array<{ image_url: string | null }>
  if (!rows[0]?.image_url) throw new Error(`article ${articleId}: no image`)
  return rows[0].image_url
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA, accept: 'image/*' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const [kind, ...targets] = process.argv.slice(2)
  if ((kind !== 'photo' && kind !== 'graphic') || targets.length === 0) {
    console.error('usage: label-photos.ts <photo|graphic> <article id or image URL>...')
    process.exit(2)
  }
  const labels: PhotoLabel[] = existsSync(PHOTO_LABELS_PATH)
    ? readFileSync(PHOTO_LABELS_PATH, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as PhotoLabel)
    : []
  const embed = await photoEmbedder()
  for (const target of targets) {
    const isUrl = /^https?:\/\//.test(target)
    const imageUrl = isUrl ? target : await imageUrlOf(target)
    // One picture at a time: the embedder's image work must not overlap.
    const emb = await embed(await download(imageUrl))
    const label: PhotoLabel = { article_id: isUrl ? '' : target, image_url: imageUrl, photo: kind === 'photo', tag: PHOTO_TAG, emb: packEmbedding(emb) }
    const same = (l: PhotoLabel) => (label.article_id && l.article_id === label.article_id) || l.image_url === label.image_url
    const replaced = labels.some(same)
    const kept = labels.filter((l) => !same(l))
    labels.length = 0
    labels.push(...kept, label)
    console.log(`${replaced ? 'relabelled' : 'labelled'} ${kind}: ${imageUrl}`)
  }
  writeFileSync(PHOTO_LABELS_PATH, labels.map((l) => JSON.stringify(l)).join('\n') + '\n')
  console.log(`${labels.length} labels in ${PHOTO_LABELS_PATH}. Next: node --import tsx scripts/train-photo-head.ts`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
