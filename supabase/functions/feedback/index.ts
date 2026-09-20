import { corsHeaders, json } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { boundedJson } from '../_shared/body.ts'
import { rateLimited } from '../_shared/ratelimit.ts'
import { sha256Hex } from '../_shared/hash.ts'

const db = serviceClient()
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error:'method_not_allowed' },405)
  const body = await boundedJson(req)
  if (body instanceof Response) return body
  if (body.website) return json({ saved:true })
  const limited = await rateLimited(db,req,'feedback',5)
  if (limited) return limited
  const category = String(body.category ?? '')
  const message = typeof body.message === 'string' ? body.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const article = body.articleId || null
  if (!['problem','correction','source','privacy'].includes(category) || message.length<10 || message.length>4000 || email.length>254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (article && (typeof article!=='string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(article)))) return json({ error:'invalid_body' },400)
  const fingerprint = await sha256Hex(JSON.stringify([category,message,email,String(article)]))
  const { data, error } = await db.rpc('submit_report', { p_category:category, p_message:message, p_email:email||null, p_article:article, p_fingerprint:fingerprint })
  if (error) return json({ error:'submission_unavailable' },503)
  if (!data) return json({ error:'daily_limit' },429)
  return json({ saved:true },201)
})
