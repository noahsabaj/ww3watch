// One-off: judge again every photo the site shows from the last
// IMAGE_CHECK_LOOKBACK_HOURS, after the photo check's rule changes
// (src/lib/server/pipeline/photo-check.ts). New images get the new rule from
// the pipeline; this catches the ones already passed under the old one.
//
//   gh workflow run run-script.yml -f script=scripts/recheck-photos.ts
import { recheckPhotos } from '../src/lib/server/pipeline/photo-check'

recheckPhotos(Date.now() + 25 * 60_000)
  .then((result) => console.log(`[recheck-photos] ${JSON.stringify(result)}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
