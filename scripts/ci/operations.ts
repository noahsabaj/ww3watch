import { writeFileSync } from 'node:fs'
import { supabaseAdmin as db } from '../../src/lib/server/supabase'
import { defaultGh, ghOrThrow } from './gh'
import { fileOrComment } from './issues'
import { checkSite } from '../ops/site-health'

// What the pipeline may read from Supabase in a day (each run counts its own,
// pipeline_runs.stats.egress.kb). 80 MB a day is half the Free plan's 5 GB a
// month, which also carries every visitor's feed, Realtime and the backups;
// the reads every run makes came to ~37 MB a day when measured (docs/OPERATIONS.md).
const PIPELINE_EGRESS_MB_PER_DAY = 80

const failures: string[] = []
failures.push(...await checkSite())
const month = new Date().toISOString().slice(0,7)+'-01'
const [pipeline,health,budgets,usage,reports,backup,fullBackup,infrastructure,runEgress] = await Promise.all([
  db.rpc('pipeline_status'),db.rpc('ops_health'),db.from('ai_budgets').select('*'),
  db.from('ai_months').select('*'),
  db.from('visitor_reports').select('id',{head:true,count:'exact'}).eq('status','new'),
  db.from('ops_events').select('occurred_at').eq('name','backup_success').maybeSingle(),
  db.from('ops_events').select('occurred_at').eq('name','full_backup_success').maybeSingle(),
  db.from('ops_events').select('occurred_at,details').eq('name','infrastructure_usage').maybeSingle(),
  // One number a run, not the stats: this check itself runs every 15 minutes.
  db.from('pipeline_runs').select('kb:stats->egress->kb').gte('started_at',new Date(Date.now()-86400_000).toISOString()),
])
for (const [name,result] of Object.entries({pipeline,health,budgets,usage,reports,backup,fullBackup,runEgress})) if(result.error) failures.push(`${name}: check unavailable`)
// Runs from before the meter record nothing, and count as nothing.
const pipelineEgressMb = (runEgress.data ?? []).reduce((sum,r)=>sum+(Number(r.kb)||0),0)/1024
if (pipelineEgressMb>PIPELINE_EGRESS_MB_PER_DAY) failures.push(`The pipeline read ${pipelineEgressMb.toFixed(0)} MB from Supabase in 24 hours (budget ${PIPELINE_EGRESS_MB_PER_DAY} MB; pipeline_runs.stats.egress.stages says which stage)`)
if (!pipeline.data || Date.now()-Date.parse(pipeline.data)>3600_000) failures.push('Ingestion has not succeeded within 60 minutes')
if (!backup.data || Date.now()-Date.parse(backup.data.occurred_at)>30*3600_000) failures.push('No successful backup within 30 hours')
// The full copy runs on Mondays (database-backup.yml); a day of slack.
if (!fullBackup.data || Date.now()-Date.parse(fullBackup.data.occurred_at)>8*24*3600_000) failures.push('No successful full backup within 8 days')
for (const b of budgets.data ?? []) {
  // No row this month means nothing reserved yet: the first reserve_ai opens
  // the month verified, provided an earlier month was (launch_safeguards.sql).
  const u = usage.data?.find(v=>v.service===b.service && v.month===month)
  const opened = u ? !!u.opening_verified_at : !!usage.data?.some(v=>v.service===b.service && v.opening_verified_at)
  if (!b.pricing_verified_at || !opened) failures.push(`${b.service}: pricing or opening usage needs verification`)
  else if (Number(u?.charged_usd ?? 0)>=Number(b.monthly_usd)*0.8) failures.push(`${b.service}: at least 80% of monthly allowance reserved or spent`)
}
const url = process.env.PAGES_BASE_PATH ? 'https://noahsabaj.github.io/ww3watch/' : 'https://ww3watch.org/'
try {
  const response = await fetch(url,{signal:AbortSignal.timeout(15000)})
  if (!response.ok || !(await response.text()).includes('WW3Watch')) failures.push('Public website response invalid')
} catch { failures.push('Public website unavailable (DNS, TLS or HTTP)') }
const summary = {checkedAt:new Date().toISOString(),site:url,lastPipeline:pipeline.data,lastBackup:backup.data?.occurred_at,health:health.data,budgets:budgets.data,usage:usage.data?.filter(v=>v.month===month),newReports:reports.count,failures,backendTraffic:{lastVerified:infrastructure.data,pipelineEgressMb24h:Math.round(pipelineEgressMb*10)/10,pipelineEgressBudgetMb:PIPELINE_EGRESS_MB_PER_DAY,refresh:'Manual dashboard verification for everything but the pipeline; not a live infrastructure meter. Refresh monthly and after traffic spikes.'}}
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
