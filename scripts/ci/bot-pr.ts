// Open-or-update the single bot PR that lives on a fixed, force-pushed branch
// (train-classifier.yml → retrain-head, backup.yml → sources-backup).
//
//   node --import tsx scripts/ci/bot-pr.ts ensure --branch <b> --title <t> [--base main] [--if-open edit|leave]
//
// The body is read from the PR_BODY env var, not argv: it is multi-line
// markdown (the retrain PR's is the holdout-metrics table) and env keeps it out
// of every quoting layer. GH_TOKEN comes from env as in any `gh` step.
//
// The git half (add / commit / force-push) stays in the workflow: it is a
// straight line of commands with one "nothing changed → stop" exit and no
// lookup whose arguments could be subtly wrong.

import { parseArgs } from 'node:util'
import { defaultGh, firstNumber, ghOrThrow, isMain, runCli, type Gh } from './gh'

export type EnsureBotPrOptions = {
  branch: string
  title: string
  body: string
  base?: string
  // What to do when an OPEN PR already exists for the branch. 'edit' rewrites
  // its body (retrain: the metrics change with every fit). 'leave' does nothing
  // (backup: the body is static, and the old bash never touched an open PR).
  ifOpen?: 'edit' | 'leave'
}

export type EnsureBotPrResult = { action: 'edited' | 'left' | 'created'; number: number | null }

export async function ensureBotPr(gh: Gh, opts: EnsureBotPrOptions): Promise<EnsureBotPrResult> {
  const { branch, title, body, base = 'main', ifOpen = 'edit' } = opts

  // OPEN PRs only. `gh pr view <branch>` also matches a MERGED PR from the same
  // branch name — and these branches are reused forever — so the second retrain
  // ever run edited the first one's closed PR and never opened its own, and
  // every backup after the first merged one would have stopped opening PRs.
  // `pr list --state open` cannot return a merged PR.
  //
  // A failed lookup throws. train-classifier.yml already behaved that way
  // (`open=$(gh pr list …)` under `bash -e`). backup.yml had the lookup inside
  // `[ -z "$(…)" ]`, where a failure read as "none open" and fell through to
  // `gh pr create`; that was an accident of quoting, not a decision, and
  // creating on the strength of a lookup that did not run is the wrong default.
  const listed = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'])
  if (listed.code !== 0) throw new Error(`gh pr list exited ${listed.code}: ${listed.stderr.trim()}`)
  const open = firstNumber(listed.stdout)

  if (open !== null) {
    if (ifOpen === 'leave') return { action: 'left', number: open }
    await ghOrThrow(gh, ['pr', 'edit', String(open), '--body', body])
    return { action: 'edited', number: open }
  }
  await ghOrThrow(gh, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body])
  return { action: 'created', number: null }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      branch: { type: 'string' },
      title: { type: 'string' },
      base: { type: 'string', default: 'main' },
      'if-open': { type: 'string', default: 'edit' },
    },
  })
  if (positionals[0] !== 'ensure') throw new Error('usage: bot-pr.ts ensure --branch <b> --title <t> [--base main] [--if-open edit|leave]')
  if (!values.branch || !values.title) throw new Error('--branch and --title are required')
  const ifOpen = values['if-open']
  if (ifOpen !== 'edit' && ifOpen !== 'leave') throw new Error('--if-open must be "edit" or "leave"')

  const result = await ensureBotPr(defaultGh, {
    branch: values.branch,
    title: values.title,
    // Unset and empty are the same thing here, as `--body "$body"` was in bash.
    body: process.env.PR_BODY ?? '',
    base: values.base,
    ifOpen,
  })
  console.log(`[bot-pr] ${result.action}${result.number !== null ? ` #${result.number}` : ''} (${values.branch})`)
}

if (isMain(import.meta.url)) runCli(main)
