// The photograph a story shows, if its newsroom published one: Signal's full
// backdrop on a phone, the head of the story pane on the desk. A hotlink the
// publisher refuses (403, mixed content) drops back to the region wash for
// that URL only, so a later photo for the same story still gets its chance.
// Never a generated or stock image (docs/CONVENTIONS.md).
//
// Must be created during component init.
import { storyImage, type Cluster, type StoryPhoto } from './cluster'

export function createStoryPhoto(getCluster: () => Cluster) {
  let brokenUrl = $state<string | null>(null)
  const photo = $derived(storyImage(getCluster()))
  const shown = $derived<StoryPhoto | null>(photo && photo.url !== brokenUrl ? photo : null)

  return {
    /** The photograph to show, or null for the colour field. */
    get shown() { return shown },
    /** Call from the <img> onerror. */
    fail() { if (photo) brokenUrl = photo.url },
  }
}
