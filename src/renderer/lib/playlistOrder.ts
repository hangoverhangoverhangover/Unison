import type { PlaylistPrefs } from '@shared/library'
import type { Playlist } from '@shared/types'

/**
 * Every playlist in sidebar order: ones not in the saved order first (new app
 * playlists first, then service playlists in the service's order), then the saved order.
 * Saved ids that no longer exist are skipped.
 */
export function orderPlaylists(all: Playlist[], prefs: PlaylistPrefs): Playlist[] {
  const byId = new Map(all.map((p) => [p.id, p]))
  const known = new Set(prefs.order)
  const fresh = all.filter((p) => !known.has(p.id))
  fresh.sort((a, b) => Number(b.source === 'app') - Number(a.source === 'app'))
  const saved = prefs.order.map((id) => byId.get(id)).filter((p): p is Playlist => !!p)
  return [...fresh, ...saved]
}

/**
 * The new saved order after the visible (non-hidden) playlists were dragged into
 * `visibleIds`. Hidden playlists keep their places relative to the visible ones;
 * ids the sidebar doesn't currently show (other service logged out) are kept at the end.
 */
export function reorder(
  current: Playlist[],
  hidden: ReadonlySet<string>,
  visibleIds: string[],
  previousOrder: string[]
): string[] {
  const queue = [...visibleIds]
  const next = current.map((p) => (hidden.has(p.id) ? p.id : (queue.shift() ?? p.id)))
  const present = new Set(next)
  return [...next, ...previousOrder.filter((id) => !present.has(id))]
}
