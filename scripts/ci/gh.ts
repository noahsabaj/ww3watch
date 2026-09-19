// The one door every `gh` call in scripts/ci/ goes through.
//
// The workflows used to carry this logic as inline bash, which nothing tested.
// Two of them shipped the same bug in one week: `gh pr view <branch>` also
// matches a MERGED PR, so "reuse the existing PR or create one" silently edited
// a closed PR. The defect was in the ARGUMENTS, so that is what the tests pin:
// every module takes a `Gh` and the tests inject a fake that records the exact
// argv. Always argv arrays, never a shell string — bodies are multi-line
// markdown with quotes, backticks and `$`, and execFile passes them through
// untouched where a shell would not.

import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export type GhResult = { stdout: string; stderr: string; code: number }
export type Gh = (args: string[]) => Promise<GhResult>

// Never rejects: a non-zero exit is a RESULT, because callers differ on what it
// means. Some lookups are deliberately tolerant (the bash had `|| true` /
// `2>/dev/null || echo ""`), while every mutation must fail the step. A `gh`
// that cannot be spawned at all reports 127, the shell's "command not found".
// Auth is GH_TOKEN from the environment, exactly as in the workflows.
export const defaultGh: Gh = (args) =>
  new Promise((resolve) => {
    execFile('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr, code: 0 })
      const code = typeof err.code === 'number' ? err.code : 127
      resolve({ stdout: stdout ?? '', stderr: stderr || err.message, code })
    })
  })

// For calls whose failure must fail the step — what `bash -e` did for a bare
// `gh issue comment …`. stdout is echoed because gh prints the URL of what it
// created or commented on, and the bash let that reach the job log.
export async function ghOrThrow(gh: Gh, args: string[]): Promise<string> {
  const res = await gh(args)
  if (res.code !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} exited ${res.code}: ${res.stderr.trim()}`)
  }
  if (res.stdout.trim()) console.log(res.stdout.trim())
  return res.stdout
}

// `[{ "number": 12 }, …]` → 12, or null for an empty list. The bash used
// `--jq '.[0].number'`; parsing here keeps the argv free of a jq program and
// makes "empty list" an explicit case instead of an empty string.
export function firstNumber(json: string): number | null {
  const rows = JSON.parse(json) as Array<{ number: number }>
  return rows.length > 0 ? rows[0].number : null
}

// ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
// — the same three values, read from the default env vars every runner sets.
export function runUrl(env: NodeJS.ProcessEnv = process.env): string {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
    throw new Error('GITHUB_SERVER_URL, GITHUB_REPOSITORY and GITHUB_RUN_ID must be set (they are on any Actions runner)')
  }
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
}

// True when `metaUrl` is the file node was asked to run, so a module can be both
// imported by its test and executed by a workflow.
export function isMain(metaUrl: string): boolean {
  return !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href
}

// Shared CLI tail: print the error and exit 1, so a failed mutation fails the
// step just as it did under `bash -e`.
export function runCli(main: () => Promise<void>): void {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
