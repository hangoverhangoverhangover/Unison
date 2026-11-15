// In-app playlists (source 'app'). They live only in this database and may mix Spotify,
// SoundCloud and local tracks. Pure DB: no IPC, no events (see index.ts for those).
import { randomUUID } from 'crypto'
import type { Playlist, Provider, Track } from '@shared/types'
import type { Db } from '../db'
import { rowToTrack, trackColumns, upsertServiceTracks, type TrackRow } from '../db/tracks'

export const APP_PREFIX = 'app:'
export const NAME_MAX = 100
export const OWNER_NAME = 'You'

const PROVIDERS = new Set<Provider>(['spotify', 'soundcloud', 'local'])

export interface AddResult {
  /** Entries appended. */
  added: number
  /** Ids of local tracks that aren't in the library (any more), so weren't added. */
  skipped: string[]
}

export interface CreateResult extends AddResult {
  playlist: Playlist
}

interface PlaylistRow {
  id: string
  native_id: string
  name: string
  track_count: number
  artwork_url: string | null
  custom_artwork: number
}

interface ItemRow {
  track_id: string
  added_at: string | null
}

export class PlaylistNotFoundError extends Error {
  constructor(id: string) {
    super(`That playlist doesn't exist (any more): ${String(id)}`)
    this.name = 'PlaylistNotFoundError'
  }
}

export function isAppPlaylistId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(APP_PREFIX) && id.length > APP_PREFIX.length
}

/** Trimmed name, 1-100 characters. */
export function validateName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new Error('Give the playlist a name.')
  if ([...n].length > NAME_MAX)
    throw new Error(`Playlist names can be at most ${NAME_MAX} characters.`)
  return n
}

/** Checks the shape the renderer sent; returns the tracks unchanged. */
export function validateTracks(tracks: unknown): Track[] {
  if (!Array.isArray(tracks)) throw new Error('No tracks given.')
  for (const t of tracks as unknown[]) {
    const o = t as Partial<Track> | null
    if (
      !o ||
      typeof o !== 'object' ||
      typeof o.provider !== 'string' ||
      !PROVIDERS.has(o.provider) ||
      typeof o.nativeId !== 'string' ||
      !o.nativeId ||
      o.id !== `${o.provider}:${o.nativeId}` ||
      typeof o.title !== 'string'
    )
      throw new Error(`Not a valid track: ${String(o?.id)}`)
  }
  return tracks as Track[]
}

const nowIso = (): string => new Date().toISOString()

// The automatic cover is the first track's artwork, worked out on every read; a
// user-chosen cover (custom_artwork = 1) wins over it.
const SELECT_PLAYLIST = `
  SELECT p.id, p.native_id, p.name, p.custom_artwork,
    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count,
    CASE WHEN p.custom_artwork = 1 AND p.artwork_url IS NOT NULL THEN p.artwork_url
      ELSE (SELECT t.artwork_url FROM playlist_items i JOIN tracks t ON t.id = i.track_id
        WHERE i.playlist_id = p.id ORDER BY i.position LIMIT 1)
    END AS artwork_url
  FROM playlists p`

function rowToPlaylist(r: PlaylistRow): Playlist {
  const p: Playlist = {
    id: r.id,
    source: 'app',
    nativeId: r.native_id,
    name: r.name,
    ownerName: OWNER_NAME,
    trackCount: r.track_count,
    canEdit: true
  }
  if (r.artwork_url) p.artworkUrl = r.artwork_url
  if (r.custom_artwork === 1) p.customArtwork = true
  return p
}

export class AppPlaylistStore {
  constructor(private readonly db: Db) {}

  /** Newest first. */
  list(): Playlist[] {
    const rows = this.db
      .prepare(`${SELECT_PLAYLIST} WHERE p.source = 'app' ORDER BY p.created_at DESC, p.rowid DESC`)
      .all() as PlaylistRow[]
    return rows.map(rowToPlaylist)
  }

  get(id: string): Playlist {
    if (!isAppPlaylistId(id)) throw new PlaylistNotFoundError(id)
    const row = this.db
      .prepare(`${SELECT_PLAYLIST} WHERE p.id = ? AND p.source = 'app'`)
      .get(id) as PlaylistRow | undefined
    if (!row) throw new PlaylistNotFoundError(id)
    return rowToPlaylist(row)
  }

  create(name: string, tracks: Track[] = []): CreateResult {
    const n = validateName(name)
    const list = validateTracks(tracks ?? [])
    const nativeId = randomUUID()
    const id = APP_PREFIX + nativeId
    const result = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO playlists (id, source, native_id, name, owner_name, can_edit, created_at)
           VALUES (?, 'app', ?, ?, ?, 1, ?)`
        )
        .run(id, nativeId, n, OWNER_NAME, nowIso())
      return this.append(id, list)
    })()
    return { playlist: this.get(id), ...result }
  }

  rename(id: string, name: string): Playlist {
    const n = validateName(name)
    this.get(id)
    this.db
      .prepare(
        `UPDATE playlists SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(n, id)
    return this.get(id)
  }

  /** Use this image as the cover until clearCustomArtwork; track changes don't replace it. */
  setCustomArtwork(id: string, url: string): Playlist {
    this.get(id)
    this.db
      .prepare(
        `UPDATE playlists SET artwork_url = ?, custom_artwork = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(url, id)
    return this.get(id)
  }

  /** Back to the automatic cover (the first track's artwork, as it is now). */
  clearCustomArtwork(id: string): Playlist {
    this.get(id)
    this.db
      .prepare(
        `UPDATE playlists SET artwork_url = NULL, custom_artwork = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(id)
    return this.get(id)
  }

  delete(id: string): void {
    this.get(id)
    // playlist_items go with it (ON DELETE CASCADE).
    this.db.prepare(`DELETE FROM playlists WHERE id = ?`).run(id)
  }

  /** In playlist order; duplicates appear once per entry. */
  getTracks(id: string): Track[] {
    this.get(id)
    const rows = this.db
      .prepare(
        `SELECT ${trackColumns('t')} FROM playlist_items i JOIN tracks t ON t.id = i.track_id
         WHERE i.playlist_id = ? ORDER BY i.position`
      )
      .all(id) as TrackRow[]
    return rows.map(rowToTrack)
  }

  /**
   * Append tracks in the given order. Service tracks are stored/refreshed in `tracks`;
   * local tracks must already be in the library, otherwise they're skipped (see result).
   */
  addTracks(id: string, tracks: Track[]): AddResult {
    const list = validateTracks(tracks)
    this.get(id)
    return this.db.transaction(() => this.append(id, list))()
  }

  /** Remove the entries at these indexes (as getTracks returned them), then renumber 0..n-1. */
  removeAt(id: string, positions: number[]): void {
    if (!Array.isArray(positions)) throw new Error('No positions given.')
    this.db.transaction(() => {
      const items = this.items(id)
      const drop = new Set<number>()
      for (const p of positions) {
        this.checkPosition(p, items.length)
        drop.add(p)
      }
      if (drop.size === 0) return
      this.rewrite(
        id,
        items.filter((_, i) => !drop.has(i))
      )
    })()
  }

  /** Move the entry at `from` so it ends up at index `to`. */
  move(id: string, from: number, to: number): void {
    this.db.transaction(() => {
      const items = this.items(id)
      this.checkPosition(from, items.length)
      this.checkPosition(to, items.length)
      if (from === to) return
      const [item] = items.splice(from, 1)
      items.splice(to, 0, item!)
      this.rewrite(id, items)
    })()
  }

  private items(id: string): ItemRow[] {
    this.get(id)
    return this.db
      .prepare(
        `SELECT track_id, added_at FROM playlist_items WHERE playlist_id = ? ORDER BY position`
      )
      .all(id) as ItemRow[]
  }

  private checkPosition(p: unknown, length: number): asserts p is number {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= length)
      throw new Error(`Position ${String(p)} is out of range (the playlist has ${length} tracks).`)
  }

  /** Replace every entry; positions become 0..n-1. Call inside a transaction. */
  private rewrite(id: string, items: ItemRow[]): void {
    this.db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ?`).run(id)
    const insert = this.db.prepare(
      `INSERT INTO playlist_items (playlist_id, position, track_id, added_at) VALUES (?, ?, ?, ?)`
    )
    items.forEach((item, i) => insert.run(id, i, item.track_id, item.added_at))
    this.touch(id)
  }

  /** Append (call inside a transaction). */
  private append(id: string, tracks: Track[]): AddResult {
    if (tracks.length === 0) return { added: 0, skipped: [] }
    upsertServiceTracks(this.db, tracks)
    const localExists = this.db.prepare(`SELECT 1 FROM tracks WHERE id = ? AND provider = 'local'`)
    const next = this.db
      .prepare(`SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_items WHERE playlist_id = ?`)
      .pluck()
      .get(id) as number
    const insert = this.db.prepare(
      `INSERT INTO playlist_items (playlist_id, position, track_id, added_at) VALUES (?, ?, ?, ?)`
    )
    const at = nowIso()
    const skipped: string[] = []
    let added = 0
    for (const t of tracks) {
      if (t.provider === 'local' && !localExists.get(t.id)) {
        skipped.push(t.id)
        continue
      }
      insert.run(id, next + added, t.id, at)
      added++
    }
    if (added > 0) this.touch(id)
    return { added, skipped }
  }

  private touch(id: string): void {
    this.db
      .prepare(
        `UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
      )
      .run(id)
  }
}
