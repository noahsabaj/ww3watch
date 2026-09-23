import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
const exec=promisify(execFile)
// Deliberately connects only to the disposable local CI container.
const sql=async query=>(await exec('docker',['exec','supabase_db_ww3watch','psql','-U','postgres','-At','-v','ON_ERROR_STOP=1','-c',query])).stdout.trim()
const clear="delete from public.ai_reservations where service='classification'; delete from public.ai_months where service='classification';"
try {
  await sql(clear+"update public.ai_budgets set model='concurrency-test',input_per_million=1000000,output_per_million=0,pricing_verified_at=now(),monthly_usd=1,max_concurrent=16 where service='classification'; insert into public.ai_months values('classification',date_trunc('month',now() at time zone 'UTC')::date,0,now());")
  const reserve=async()=>JSON.parse(await sql("select public.reserve_ai('classification','concurrency-test',1,0)"))
  const budget=await Promise.all(Array.from({length:16},reserve))
  assert.equal(budget.filter(r=>r.id).length,1)
  assert.equal(budget.filter(r=>r.error==='budget_exhausted').length,15)
  assert.equal(Number(await sql("select charged_usd from public.ai_months where service='classification'")),1)
  await sql(clear+"update public.ai_budgets set monthly_usd=20,max_concurrent=2 where service='classification'; insert into public.ai_months values('classification',date_trunc('month',now() at time zone 'UTC')::date,0,now());")
  const concurrent=await Promise.all(Array.from({length:16},reserve))
  assert.equal(concurrent.filter(r=>r.id).length,2)
  assert.equal(concurrent.filter(r=>r.error==='busy').length,14)
  console.log('Concurrent reservations respect both spending and provider concurrency limits.')
} finally {
  await sql(clear+"update public.ai_budgets set model=null,input_per_million=null,output_per_million=null,pricing_verified_at=null,monthly_usd=20,max_concurrent=16 where service='classification';")
}
