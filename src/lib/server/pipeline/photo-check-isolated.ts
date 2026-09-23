// The photo check in its own process. The check loads two native libraries
// (libvips through sharp, ONNX Runtime through transformers.js), and on
// 2026-09-23 one of them aborted the whole pipeline process ("free(): double
// free", exit 134) after every other stage had persisted but before the run
// was recorded: a healthy run read as a failure, and the site's "updated"
// readout went stale. In a child process a crash costs only this stage.
import { spawn } from 'node:child_process'
import type { RunStats } from './stats'

export const PHOTO_STATS_PREFIX = '[photo-stats] '
// Past the run's deadline the child has had its chance; don't let a hung one
// hold the job.
const KILL_GRACE_MS = 60_000

/** The stats line the child prints (scripts/check-photos.ts --once). */
export function parsePhotoStats(output: string): RunStats | null {
  for (const line of output.split('\n').reverse()) {
    const at = line.indexOf(PHOTO_STATS_PREFIX)
    if (at < 0) continue
    try {
      return JSON.parse(line.slice(at + PHOTO_STATS_PREFIX.length)) as RunStats
    } catch {
      return null
    }
  }
  return null
}

export async function checkPhotosIsolated(
  stats: RunStats,
  deadlineMs: number,
  args: string[] = ['--import', 'tsx', 'scripts/check-photos.ts', '--once', String(deadlineMs)],
): Promise<void> {
  const { code, signal, output } = await new Promise<{ code: number | null; signal: string | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      process.stdout.write(chunk)
    })
    const killer = setTimeout(() => child.kill('SIGKILL'), Math.max(0, deadlineMs - Date.now()) + KILL_GRACE_MS)
    child.on('error', (err) => {
      clearTimeout(killer)
      resolve({ code: null, signal: null, output: `${output}\n${String(err)}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(killer)
      resolve({ code, signal, output })
    })
  })
  const result = parsePhotoStats(output)
  if (result) Object.assign(stats, result)
  if (code !== 0) {
    stats.photos_error = `photo check process exited ${signal ?? code}${result?.photos_error ? `: ${result.photos_error}` : ''}`.slice(0, 200)
    console.error(`[pipeline] ${stats.photos_error} (non-fatal; verdicts already written stay)`)
  }
}
