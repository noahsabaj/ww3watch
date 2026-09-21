// Self-chain pacing for pipeline.yml's "Chain the next run" step.
//
//   node --import tsx scripts/ci/chain.ts --start <job-start-epoch> --workflow pipeline.yml --ref <branch>
//
// Each pipeline run dispatches the next one, because GitHub throttles a busy
// '*/15' cron down to a handful of firings a day. The next run should START
// CADENCE_SECONDS (env, set at the top of the workflow) after THIS job started:
// a quick run sleeps the remainder so it doesn't become a tight loop of LLM
// calls, and a slow one dispatches immediately.

import { parseArgs } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { defaultGh, ghOrThrow, isMain, runCli, type Gh } from './gh'

// Seconds to wait before dispatching. `cadence - elapsed`, floored at 0: a run
// that took longer than the cadence is already late and must not wait at all
// (the bash guarded its `sleep` with `[ "$wait" -gt 0 ]`). A start time in the
// future (clock step) gives more than `cadence`, as the bash arithmetic did;
// the job's timeout-minutes bounds that.
export function nextRunDelaySeconds(startEpoch: number, nowEpoch: number, cadence: number): number {
  for (const [name, v] of Object.entries({ startEpoch, nowEpoch, cadence })) {
    // bash `$(( … ))` errored on a non-number and failed the step; NaN would
    // instead flow into setTimeout as "no delay" and quietly unpace the chain.
    if (!Number.isFinite(v)) throw new Error(`${name} is not a number`)
  }
  return Math.max(0, cadence - (nowEpoch - startEpoch))
}

export type ChainOptions = {
  startEpoch: number
  cadence: number
  workflow: string
  ref: string
  yieldTo?: string // workflow that may not be displaced; '' disables the check
  now?: () => number // epoch seconds
  wait?: (seconds: number) => Promise<unknown>
}

// GitHub holds at most ONE pending run per concurrency group, so a dispatch
// lands on a waiting run and cancels it. That is deliberate between chained
// ingestion runs — a stale backstop firing should be replaced — but
// source-curation.yml shares the group (its writes must not interleave with
// ingestion's), and the chain dispatches while this job is still in progress.
// A curation run therefore waited, was displaced by the next chained dispatch,
// and was cancelled. Every time: source-curation.yml had never once run.
const WAITING = new Set(['queued', 'pending', 'waiting', 'requested', 'in_progress'])

// A tolerant lookup: if `gh` fails or prints something unparseable we chain as
// before. Losing one curation run to a displaced dispatch is recoverable (it is
// re-dispatchable by hand); stopping ingestion on a flaky list call is not.
export async function isWaiting(gh: Gh, workflow: string): Promise<boolean> {
  const res = await gh(['run', 'list', '--workflow', workflow, '--limit', '20', '--json', 'status'])
  if (res.code !== 0) {
    console.log(`[chain] could not list ${workflow} runs (exit ${res.code}); chaining anyway`)
    return false
  }
  try {
    return (JSON.parse(res.stdout) as Array<{ status: string }>).some(r => WAITING.has(r.status))
  } catch {
    console.log(`[chain] could not parse the ${workflow} run list; chaining anyway`)
    return false
  }
}

export async function chainNextRun(gh: Gh, opts: ChainOptions): Promise<{ sleptSeconds: number; dispatched: boolean }> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const wait = opts.wait ?? ((s: number) => sleep(s * 1000))

  const nowEpoch = now()
  const delay = nextRunDelaySeconds(opts.startEpoch, nowEpoch, opts.cadence)
  if (delay > 0) {
    console.log(`[chain] run took ${nowEpoch - opts.startEpoch}s; sleeping ${delay}s to pace the next start`)
    await wait(delay)
  }
  // Checked AFTER the pacing sleep, not before: the sleep is most of the
  // cadence, and a curation run dispatched during it is exactly the one this
  // has to see. Yielding drops this link of the chain rather than the curation
  // run; source-curation.yml re-dispatches the pipeline when it finishes, and
  // the backstop cron covers a curation run that never starts.
  if (opts.yieldTo && await isWaiting(gh, opts.yieldTo)) {
    console.log(`[chain] ${opts.yieldTo} is waiting on this concurrency group; not dispatching, it restarts the chain`)
    return { sleptSeconds: delay, dispatched: false }
  }
  // workflow_dispatch is one of the two events GITHUB_TOKEN may trigger. A
  // failed dispatch throws → exit 1, as `gh workflow run … && echo …` did.
  await ghOrThrow(gh, ['workflow', 'run', opts.workflow, '--ref', opts.ref])
  console.log('[chain] dispatched the next run')
  return { sleptSeconds: delay, dispatched: true }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { start: { type: 'string' }, workflow: { type: 'string' }, ref: { type: 'string' }, 'yield-to': { type: 'string' } },
  })
  if (!values.start || !values.workflow || !values.ref) throw new Error('usage: chain.ts --start <epoch> --workflow <file> --ref <ref> [--yield-to <file>]')
  // Number(''), unlike bash's $(( )), is 0 — so empty is rejected by hand.
  const cadenceRaw = process.env.CADENCE_SECONDS
  if (!cadenceRaw) throw new Error('CADENCE_SECONDS is not set')
  await chainNextRun(defaultGh, {
    startEpoch: Number(values.start),
    cadence: Number(cadenceRaw),
    workflow: values.workflow,
    ref: values.ref,
    yieldTo: values['yield-to'],
  })
}

if (isMain(import.meta.url)) runCli(main)
