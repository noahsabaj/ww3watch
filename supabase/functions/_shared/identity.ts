export async function privateBucket(ip: string, secret: string, day = new Date().toISOString().slice(0,10)): Promise<string> {
  if (!secret) throw new Error('missing_abuse_key')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, enc.encode(`ww3watch-abuse-v1:${day}:${ip}`))
  return 'h1:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('')
}
