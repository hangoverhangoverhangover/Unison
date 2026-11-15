// Sidebar order and hidden playlists (QoL round), one JSON value in the settings table.
import type { PlaylistPrefs } from '@shared/library'
import type { Db } from '../db'

/** settings key (JSON PlaylistPrefs). */
export const PREFS_KEY = 'playlists.prefs'
export const PREFS_MAX_IDS = 5000
/** Longest playlist id accepted; real ids are far shorter. */
export const PREFS_MAX_ID_LENGTH = 512

const ID = /^(app|spotify|soundcloud):.+/s

export const emptyPrefs = (): PlaylistPrefs => ({ order: [], hidden: [] })

function idList(value: unknown, field: keyof PlaylistPrefs): string[] {
  if (!Array.isArray(value)) throw new Error(`Playlist ${field} must be a list of playlist ids.`)
  if (value.length > PREFS_MAX_IDS)
    throw new Error(`Playlist ${field} can hold at most ${PREFS_MAX_IDS} playlists.`)
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of value as unknown[]) {
    if (typeof id !== 'string' || !ID.test(id) || id.length > PREFS_MAX_ID_LENGTH)
      throw new Error(`Not a valid playlist id in ${field}: ${String(id).slice(0, 80)}`)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Checks what the renderer sent; returns a deduped copy (first occurrence wins). */
export function validatePrefs(prefs: unknown): PlaylistPrefs {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))
    throw new Error('Playlist settings must have an order and a hidden list.')
  const p = prefs as Partial<Record<keyof PlaylistPrefs, unknown>>
  return { order: idList(p.order, 'order'), hidden: idList(p.hidden, 'hidden') }
}

/** Missing or corrupt data reads as empty lists. */
export function readPrefs(db: Db): PlaylistPrefs {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(PREFS_KEY) as
    string | undefined
  if (row === undefined) return emptyPrefs()
  try {
    return validatePrefs(JSON.parse(row))
  } catch {
    return emptyPrefs()
  }
}

/** Validates, stores and returns the stored value. */
export function writePrefs(db: Db, prefs: unknown): PlaylistPrefs {
  const clean = validatePrefs(prefs)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(PREFS_KEY, JSON.stringify(clean))
  return clean
}

/** Drop a playlist from both lists (after it was deleted). No write when it isn't there. */
export function forgetPlaylist(db: Db, id: string): void {
  const prefs = readPrefs(db)
  const order = prefs.order.filter((x) => x !== id)
  const hidden = prefs.hidden.filter((x) => x !== id)
  if (order.length === prefs.order.length && hidden.length === prefs.hidden.length) return
  writePrefs(db, { order, hidden })
}
