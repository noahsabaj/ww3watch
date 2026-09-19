// Issue filing / commenting / auto-closing for the workflows' push alerts.
//
//   node --import tsx scripts/ci/issues.ts disabled-sources      # reads DISABLED
//   node --import tsx scripts/ci/issues.ts low-yield             # reads LOW_YIELD
//   node --import tsx scripts/ci/issues.ts close --label <l> --message <m>
//
// Source lists come from ENV VARS the workflow already sets from the pipeline's
// step outputs — they are multi-line and contain `:` `/` `%` `(`, so they stay
// out of argv. GH_TOKEN comes from env as in any `gh` step.
//
// NOT here, on purpose: the "Alert on failure" steps in pipeline.yml and
// prod-smoke.yml. They must fire when checkout, setup-node or `npm ci` is the
// thing that broke, and this file needs all three. They stay in bash.
//
// Push, don't pull: the site's freshness readout requires someone to LOOK at
// it. One open issue per label emails the maintainer instead.

import { parseArgs } from 'node:util'
import { defaultGh, firstNumber, ghOrThrow, isMain, runCli, runUrl, type Gh } from './gh'

export type Label = { name: string; color: string; description: string }

export const LABELS = {
  feedHealth: { name: 'feed-health', color: 'FBCA04', description: 'Feed sources needing re-curation' },
} satisfies Record<string, Label>

// `gh label create … --force >/dev/null 2>&1 || true`. Idempotent upsert whose
// failure is deliberately ignored: if the label truly cannot exist, the
// `issue create --label` that follows fails loudly with the real reason, and
// when it already exists a hiccup here must not block the alert.
async function ensureLabel(gh: Gh, label: Label): Promise<void> {
  try {
    await gh(['label', 'create', label.name, '--color', label.color, '--description', label.description, '--force'])
  } catch {
    // tolerated — see above
  }
}

// `existing=$(gh issue list … 2>/dev/null || echo "")`. A failed lookup reads as
// "nothing open", deliberately: for filing, that falls through to `issue
// create`, which either works (at worst a second issue — better than a swallowed
// alert) or fails the step with the real error; for closing it is a no-op and
// the next successful run tries again.
async function findOpenIssue(gh: Gh, label: string, search?: string): Promise<number | null> {
  const args = ['issue', 'list', '--label', label, '--state', 'open']
  if (search) args.push('--search', search)
  args.push('--json', 'number')
  try {
    const res = await gh(args)
    return res.code === 0 ? firstNumber(res.stdout) : null
  } catch {
    return null
  }
}

export type FileOrCommentOptions = {
  label: Label
  title: string
  body: string
  // Extra `gh issue list --search` qualifier, to pick one issue among several
  // that share the label.
  search?: string
  // When set, an existing issue is only commented on if neither its body nor
  // any of its comments already contains this exact string.
  dedupeMarker?: string
}

export type FileOrCommentResult = { action: 'created' | 'commented' | 'unchanged'; number: number | null }

// At most one open issue: create it, or append to the one that is there.
export async function fileOrComment(gh: Gh, opts: FileOrCommentOptions): Promise<FileOrCommentResult> {
  const { label, title, body, search, dedupeMarker } = opts
  await ensureLabel(gh, label)
  const existing = await findOpenIssue(gh, label.name, search)

  if (existing === null) {
    await ghOrThrow(gh, ['issue', 'create', '--title', title, '--label', label.name, '--body', body])
    return { action: 'created', number: null }
  }

  if (dedupeMarker !== undefined) {
    // `gh issue view N --json body,comments --jq '.body, .comments[].body' | grep -qF -- "$marker"`.
    // The marker is a single line, so grep's per-line fixed-string match is a
    // substring test over the same text. A failed view reads as "marker not
    // seen" and we comment — the pipeline had no pipefail, so that is what the
    // bash did too, and a redundant comment beats a silently dropped one.
    let seen = false
    try {
      const res = await gh(['issue', 'view', String(existing), '--json', 'body,comments'])
      if (res.code === 0) {
        const issue = JSON.parse(res.stdout) as { body?: string | null; comments?: Array<{ body?: string | null }> }
        const texts = [issue.body ?? '', ...(issue.comments ?? []).map((c) => c.body ?? '')]
        seen = texts.some((t) => t.includes(dedupeMarker))
      }
    } catch {
      seen = false
    }
    if (seen) return { action: 'unchanged', number: existing }
  }

  await ghOrThrow(gh, ['issue', 'comment', String(existing), '--body', body])
  return { action: 'commented', number: existing }
}

// Close the open issue carrying `label`, if there is one. No-op otherwise.
export async function closeOpen(gh: Gh, opts: { label: string; comment: string }): Promise<{ closed: number | null }> {
  const existing = await findOpenIssue(gh, opts.label)
  if (existing === null) return { closed: null }
  await ghOrThrow(gh, ['issue', 'close', String(existing), '--comment', opts.comment, '--reason', 'completed'])
  return { closed: existing }
}

// ── text ────────────────────────────────────────────────────────────────────

// The lines `echo "$VAR" | …` fed down the pipe: echo appends one newline, so
// split on \n and drop the single empty tail. An embedded blank line survives,
// exactly as it did through sed/cut.
function echoLines(value: string): string[] {
  return `${value}\n`.split('\n').slice(0, -1)
}

// `sed 's/^/- /'`, then `$(…)` stripping trailing newlines.
function bullets(value: string): string {
  return echoLines(value).map((l) => `- ${l}`).join('\n').replace(/\n+$/, '')
}

// Byte order of UTF-8 == code-point order, which is what `sort` gives under the
// runner's C.UTF-8 locale. Array.prototype.sort() alone compares UTF-16 code
// units and would order astral characters differently — and a different order
// is a different marker, i.e. one spurious comment.
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!
    if (d !== 0) return d
  }
  return x.length - y.length
}

// A source the run just switched off (AUTO_DISABLE_AFTER consecutive failures)
// needs a person: a moved feed URL, a WAF that now blocks the runner and proxy
// alike, or a dead outlet. One feed-health issue collects them; curation is SQL
// against the sources table, then close it.
//
// "200" is scripts/run-pipeline.ts's AUTO_DISABLE_AFTER default. It was a
// literal in the workflow too; it is not imported because that module runs the
// pipeline at import.
export function disabledSourcesIssue(disabled: string, url: string): FileOrCommentOptions {
  return {
    label: LABELS.feedHealth,
    title: 'Feed sources auto-disabled — re-curation needed',
    body:
      `Auto-disabled after 200 consecutive failed fetches (run ${url}):\n\n` +
      `${bullets(disabled)}\n\n` +
      'Fix the feed URL or leave it disabled; re-enable with SQL on the sources table.',
    // No `search`: like the bash, this appends to the NEWEST open feed-health
    // issue, which may be the low-yield one.
  }
}

// `names=$(echo "$LOW_YIELD" | cut -d: -f1 | sort | tr '\n' ',')` — the source
// name is everything before the first colon, and every name (the last one too)
// ends up followed by a comma. Must stay byte-identical: markers written by the
// bash version are already sitting in open issues.
export function lowYieldMarker(lowYield: string): string {
  const names = echoLines(lowYield)
    .map((l) => l.split(':')[0])
    .sort(byCodePoint)
    .map((n) => `${n},`)
    .join('')
  return `<!-- low-yield: ${names} -->`
}

// Feeds that fetch fine but yield ~nothing (source_yield RPC). One open
// feed-health issue at a time; it is only commented on when the LIST changes —
// the marker is the sorted source names, not the counts — so a standing list
// does not get a comment every 15 minutes.
export function lowYieldIssue(lowYield: string): FileOrCommentOptions {
  const marker = lowYieldMarker(lowYield)
  return {
    label: LABELS.feedHealth,
    title: 'Feed sources with low-yield — re-curation suggested',
    body:
      `${marker}\n` +
      'Fetching fine, but almost nothing accepted over the last 7 days (≥100 items, ≤2% accepted):\n\n' +
      `${bullets(lowYield)}\n\n` +
      "Swap the URL for the outlet's world/conflict section feed, or disable it, with SQL on the sources table.",
    search: 'low-yield in:title',
    dedupeMarker: marker,
  }
}

// "Pipeline run succeeded: <url>. Auto-closing issue."
export function resolvedComment(message: string, url: string): string {
  return `${message}: ${url}. Auto-closing issue.`
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name]
  // The workflow's `if:` already guarantees non-empty; an empty list here means
  // the step was wired wrong, and filing an empty issue would hide that.
  if (!v) throw new Error(`${name} is empty or unset`)
  return v
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { label: { type: 'string' }, message: { type: 'string' } },
  })
  const cmd = positionals[0]

  if (cmd === 'disabled-sources') {
    const r = await fileOrComment(defaultGh, disabledSourcesIssue(requireEnv('DISABLED'), runUrl()))
    console.log(`[issues] disabled-sources: ${r.action}`)
  } else if (cmd === 'low-yield') {
    const r = await fileOrComment(defaultGh, lowYieldIssue(requireEnv('LOW_YIELD')))
    console.log(`[issues] low-yield: ${r.action}`)
  } else if (cmd === 'close') {
    if (!values.label || !values.message) throw new Error('close needs --label and --message')
    const r = await closeOpen(defaultGh, { label: values.label, comment: resolvedComment(values.message, runUrl()) })
    console.log(r.closed === null ? `[issues] no open ${values.label} issue` : `[issues] closed #${r.closed}`)
  } else {
    throw new Error('usage: issues.ts <disabled-sources | low-yield | close --label <l> --message <m>>')
  }
}

if (isMain(import.meta.url)) runCli(main)
