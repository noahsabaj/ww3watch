// The colour a story's region washes its surface with — Signal's backdrop on a
// phone, the story pane's on the desk. RGB triples for rgba(var(--wash), a).
const WASH: Record<string, string> = {
  'US/Western': '59, 99, 180',
  'UK': '80, 130, 190',
  'European': '90, 96, 170',
  'Israeli': '196, 112, 62',
  'Iranian': '150, 58, 58',
  'Arab/Gulf': '46, 128, 128',
  'Kurdish': '120, 80, 160',
  'Turkish': '160, 96, 80',
  'Russian': '160, 70, 80',
  'Ukrainian': '180, 150, 50',
  'Chinese': '170, 60, 60',
  'South Asian': '70, 140, 110',
  'East Asian': '50, 140, 150',
  'African': '90, 140, 80',
  'Independent/OSINT': '120, 118, 110',
}

export function regionWash(region: string): string {
  return WASH[region] ?? '110, 114, 128'
}
