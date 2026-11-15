// Recent searches for the empty search page. Per-device convenience kept in
// localStorage; every access may fail (blocked storage), so failures read as empty.

const KEY = 'cp.recentSearches'
const MAX = 10

export function loadRecentSearches(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === 'string') : []
  } catch {
    return []
  }
}

function store(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // not saved; the list still works for this session's caller
  }
}

/** Put `query` first (case-insensitive dedupe), keep at most 10. Returns the new list. */
export function addRecentSearch(query: string): string[] {
  const q = query.trim()
  if (!q) return loadRecentSearches()
  const lower = q.toLowerCase()
  const list = [q, ...loadRecentSearches().filter((x) => x.toLowerCase() !== lower)].slice(0, MAX)
  store(list)
  return list
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
