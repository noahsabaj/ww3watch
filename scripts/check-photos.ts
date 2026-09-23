// One-off / on-demand: run the pipeline's photo check (src/lib/server/pipeline/
// photo-check.ts) over the whole unchecked backlog instead of one run's share.
// The site shows no photo until it has been checked, so this is what brings
// photos back straight after the check first ships.
//
//   gh workflow run run-script.yml -f script=scripts/check-photos.ts
import { checkPhotos } from '../src/lib/server/pipeline/photo-check'
import type { RunStats } from '../src/lib/server/pipeline/stats'

async function main() {
  for (let pass = 1; pass <= 20; pass++) {
    const stats: RunStats = {}
    await checkPhotos(stats, Date.now() + 10 * 60_000, { cap: 400 })
    if (stats.photos_error) throw new Error(String(stats.photos_error))
    const judged = Number(stats.photos_ok ?? 0) + Number(stats.photos_emblem ?? 0)
    console.log(`[check-photos] pass ${pass}: ${JSON.stringify(stats)}`)
    if (judged === 0) break
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
