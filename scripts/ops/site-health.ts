import { connect } from 'node:tls'

export async function checkSite(): Promise<string[]> {
  const failures:string[]=[]
  const host=process.env.PAGES_BASE_PATH ? 'noahsabaj.github.io' : 'ww3watch.org'
  try {
    const expires = await new Promise<number>((resolve,reject)=> {
      const socket=connect({host,port:443,servername:host,rejectUnauthorized:true},()=>{
        const expiration=Date.parse(socket.getPeerCertificate().valid_to)
        socket.end(); resolve(expiration)
      })
      socket.setTimeout(10000,()=>socket.destroy(new Error('TLS timeout')))
      socket.on('error',reject)
    })
    if (!Number.isFinite(expires)||expires-Date.now()<14*86400_000) failures.push('Certificate expires within 14 days or expiry unavailable')
  } catch { failures.push('Certificate verification failed') }
  const root=process.env.PAGES_BASE_PATH ? 'https://noahsabaj.github.io/ww3watch/' : 'https://ww3watch.org/'
  const urls=process.env.PAGES_BASE_PATH ? [root] : [root,'http://ww3watch.org/','https://www.ww3watch.org/','https://noahsabaj.github.io/ww3watch/']
  for(const url of urls) {
    try {
      const response=await fetch(url+'?article=ops-check&story=ops-check',{signal:AbortSignal.timeout(10000)})
      const final=new URL(response.url)
      if (!response.ok||final.origin!==new URL(root).origin||final.searchParams.get('article')!=='ops-check'||final.searchParams.get('story')!=='ops-check') failures.push(`Website or redirect failed: ${new URL(url).host}`)
      await response.body?.cancel()
    } catch { failures.push(`Website unavailable: ${new URL(url).host}`) }
  }
  return failures
}
