import { json } from '@sveltejs/kit'
import { extractArticle } from '$lib/server/reader'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const articleUrl = url.searchParams.get('url')
  if (!articleUrl) return json({ error: 'missing_url' }, { status: 400 })

  try {
    const parsed = new URL(articleUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return json({ error: 'invalid_url' }, { status: 400 })
    }
  } catch {
    return json({ error: 'invalid_url' }, { status: 400 })
  }

  const article = await extractArticle(articleUrl)
  if (!article) return json({ error: 'extraction_failed' }, { status: 422 })

  return json(article)
}
