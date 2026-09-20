// Fetch-only diagnostics: no health writes, classification, or editorial decisions.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { fetchFeed } from '../../src/lib/server/rss'
import type { Feed } from '../../src/lib/types'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('Supabase configuration missing')
if (process.env.CI && (!process.env.FEED_PROXY_URL || !process.env.FEED_PROXY_SECRET)) throw new Error('Production feed proxy configuration missing')
const db = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await db.from('sources').select('id,name,url,region,lang,affiliation,enabled').order('name')
if (error || !data?.length) throw new Error('Source roster unavailable')
const candidatesPath = 'data/source-proposals.json'
const candidates: Feed[] = existsSync(candidatesPath) ? JSON.parse(readFileSync(candidatesPath, 'utf8')) : []
const feeds: Feed[] = [...data, ...candidates]
if (feeds.length > 500) throw new Error('Unexpected probe count')
const results: unknown[] = []
let next = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) {
    const feed = feeds[next++]
    if (!feed) return
    const checkedAt = new Date().toISOString()
    const result = await fetchFeed(feed)
    results.push({
      sourceId: feed.id ?? null, name: feed.name, url: feed.url, checkedAt,
      via: result.via, error: result.error ?? null, itemCount: result.articles.length,
      samples: result.articles.slice(0, 15).map(a => ({ title: a.title, url: a.url, publishedAt: a.published_at })),
    })
  }
}))
mkdirSync('.tmp/source-audit', { recursive: true })
writeFileSync('.tmp/source-audit/probes.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n')
console.log(`Probed ${feeds.length} feeds; no roster or provider changes made.`)
