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
  now?: () => number // epoch seconds
  wait?: (seconds: number) => Promise<unknown>
}

export async function chainNextRun(gh: Gh, opts: ChainOptions): Promise<{ sleptSeconds: number }> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const wait = opts.wait ?? ((s: number) => sleep(s * 1000))

  const nowEpoch = now()
  const delay = nextRunDelaySeconds(opts.startEpoch, nowEpoch, opts.cadence)
  if (delay > 0) {
    console.log(`[chain] run took ${nowEpoch - opts.startEpoch}s; sleeping ${delay}s to pace the next start`)
    await wait(delay)
  }
  // workflow_dispatch is one of the two events GITHUB_TOKEN may trigger. A
  // failed dispatch throws → exit 1, as `gh workflow run … && echo …` did.
  await ghOrThrow(gh, ['workflow', 'run', opts.workflow, '--ref', opts.ref])
  console.log('[chain] dispatched the next run')
  return { sleptSeconds: delay }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { start: { type: 'string' }, workflow: { type: 'string' }, ref: { type: 'string' } },
  })
  if (!values.start || !values.workflow || !values.ref) throw new Error('usage: chain.ts --start <epoch> --workflow <file> --ref <ref>')
  // Number(''), unlike bash's $(( )), is 0 — so empty is rejected by hand.
  const cadenceRaw = process.env.CADENCE_SECONDS
  if (!cadenceRaw) throw new Error('CADENCE_SECONDS is not set')
  await chainNextRun(defaultGh, {
    startEpoch: Number(values.start),
    cadence: Number(cadenceRaw),
    workflow: values.workflow,
    ref: values.ref,
  })
}

if (isMain(import.meta.url)) runCli(main)
