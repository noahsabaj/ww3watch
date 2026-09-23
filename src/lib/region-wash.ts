// The colour a story's region washes its surface with — Signal's backdrop on a
// phone, the story pane's on the desk. RGB triples for rgba(var(--wash), a),
// defined with the region's other colours in REGIONS (types.ts).
import { REGIONS } from './types'

export function regionWash(region: string): string {
  return (REGIONS as Record<string, { wash?: string }>)[region]?.wash ?? '110, 114, 128'
}
