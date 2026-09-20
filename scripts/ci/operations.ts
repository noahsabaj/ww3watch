import { writeFileSync } from 'node:fs'
import { supabaseAdmin as db } from '../../src/lib/server/supabase'
import { defaultGh, ghOrThrow } from './gh'
import { fileOrComment } from './issues'
import { checkSite } from '../ops/site-health'

const failures: string[] = []
failures.push(...await checkSite())
const month = new Date().toISOString().slice(0,7)+'-01'
const [pipeline,health,budgets,usage,reports,backup] = await Promise.all([
  db.rpc('pipeline_status'),db.rpc('ops_health'),db.from('ai_budgets').select('*'),
  db.from('ai_months').select('*').eq('month',month),
  db.from('visitor_reports').select('id',{head:true,count:'exact'}).eq('status','new'),
  db.from('ops_events').select('occurred_at').eq('name','backup_success').maybeSingle(),
])
for (const [name,result] of Object.entries({pipeline,health,budgets,usage,reports,backup})) if(result.error) failures.push(`${name}: check unavailable`)
if (!pipeline.data || Date.now()-Date.parse(pipeline.data)>3600_000) failures.push('Ingestion has not succeeded within 60 minutes')
if (!backup.data || Date.now()-Date.parse(backup.data.occurred_at)>30*3600_000) failures.push('No successful backup within 30 hours')
for (const b of budgets.data ?? []) {
  const u = usage.data?.find(v=>v.service===b.service)
  if (!b.pricing_verified_at || !u?.opening_verified_at) failures.push(`${b.service}: pricing or opening usage needs verification`)
  else if (Number(u.charged_usd)>=Number(b.monthly_usd)*0.8) failures.push(`${b.service}: at least 80% of monthly allowance reserved or spent`)
}
const url = process.env.PAGES_BASE_PATH ? 'https://noahsabaj.github.io/ww3watch/' : 'https://ww3watch.org/'
try {
  const response = await fetch(url,{signal:AbortSignal.timeout(15000)})
  if (!response.ok || !(await response.text()).includes('WW3Watch')) failures.push('Public website response invalid')
} catch { failures.push('Public website unavailable (DNS, TLS or HTTP)') }
const summary = {checkedAt:new Date().toISOString(),site:url,lastPipeline:pipeline.data,lastBackup:backup.data?.occurred_at,health:health.data,budgets:budgets.data,usage:usage.data,newReports:reports.count,failures,backendTraffic:'Inspect Supabase usage dashboard; not measured by this database snapshot'}
writeFileSync('operations-summary.json',JSON.stringify(summary,null,2))
const label = {name:'operations-attention',color:'B60205',description:'Availability, backup or spending requires attention'}
if (failures.length) {
  const marker = `ops:${failures.join('|')}`
  await fileOrComment(defaultGh,{label,title:'WW3Watch operations need attention',body:failures.map(s=>`- ${s}`).join('\n')+`\n\n<!-- ${marker} -->`,dedupeMarker:marker})
} else {
  const open = JSON.parse(await ghOrThrow(defaultGh,['issue','list','--label',label.name,'--state','open','--json','number'])) as Array<{number:number}>
  for(const issue of open) await ghOrThrow(defaultGh,['issue','close',String(issue.number),'--comment','Availability, ingestion, backup and budget checks recovered.'])
}
if (reports.count) await fileOrComment(defaultGh,{label:{name:'private-feedback',color:'1D76DB',description:'Private reports await review'},title:'Private visitor feedback awaits review',body:`${reports.count} private report(s) await review through Codex/Supabase. Report contents and contact details are not included here.`,dedupeMarker:`${reports.count} private report(s)`})
if (failures.length) process.exitCode=1
