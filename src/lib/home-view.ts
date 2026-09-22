export type HomeView = 'signal' | 'list'

const STORAGE_KEY = 'ww3-home-view'

export function isHomeView(value: unknown): value is HomeView {
  return value === 'signal' || value === 'list'
}

/** Query string wins, then the remembered choice, then Signal. */
export function parseHomeView(search: string, stored: string | null): HomeView {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const fromQuery = params.get('view')
  if (isHomeView(fromQuery)) return fromQuery
  if (isHomeView(stored)) return stored
  return 'signal'
}

export function readStoredHomeView(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeHomeView(view: HomeView): void {
  try {
    localStorage.setItem(STORAGE_KEY, view)
  } catch {
    // private mode / storage disabled
  }
}
