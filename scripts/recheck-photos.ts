// Judge again every picture checked in the last IMAGE_CHECK_LOOKBACK_HOURS,
// after the photo head changes (scripts/train-photo-head.ts). New pictures get
// the new head from the pipeline; this re-judges the ones checked under the
// old one, in both directions.
//
//   gh workflow run run-script.yml -f script=scripts/recheck-photos.ts
import { recheckPhotos } from '../src/lib/server/pipeline/photo-check'

recheckPhotos(Date.now() + 25 * 60_000)
  .then((result) => console.log(`[recheck-photos] ${JSON.stringify(result)}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
