import type { Db } from '../db'
import type { Track } from '@shared/types'
import { artworkUrl } from '@shared/library'
import { trackId } from '@shared/types'

const FOLDERS_KEY = 'library.folders'

/** Everything the scanner extracts from one file. */
export interface LocalTrackRecord {
  nativeId: string
  path: string
  title: string
  artists: string[]
  album?: string
  durationMs: number
  trackNo?: number
  discNo?: number
  isrc?: string
  artHash?: string
  mtimeMs: number
  size: number
}

export interface LocalFileRow {
  nativeId: string
  path: string
  mtimeMs: number | null
  size: number | null
}

interface TrackRow {
  native_id: string
  title: string
  artists: string
  album: string | null
  duration_ms: number
  artwork_url: string | null
  isrc: string | null
  local_path: string | null
  source_sc_id: string | null
}

export function getFolders(db: Db): string[] {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(FOLDERS_KEY) as
    string | undefined
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : []
  } catch {
    return []
  }
}

export function setFolders(db: Db, folders: readonly string[]): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(FOLDERS_KEY, JSON.stringify(folders))
}

export function countLocalTracks(db: Db): number {
  return db.prepare(`SELECT COUNT(*) FROM tracks WHERE provider = 'local'`).pluck().get() as number
}

export function getLocalTracks(db: Db): Track[] {
  const rows = db
    .prepare(
      `SELECT native_id, title, artists, album, duration_ms, artwork_url, isrc, local_path, source_sc_id
       FROM tracks WHERE provider = 'local'
       ORDER BY json_extract(artists, '$[0]') COLLATE NOCASE, album COLLATE NOCASE,
                disc_no, track_no, title COLLATE NOCASE`
    )
    .all() as TrackRow[]
  return rows.map(toTrack)
}

function toTrack(row: TrackRow): Track {
  let artists: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.artists)
    if (Array.isArray(parsed)) artists = parsed.filter((a): a is string => typeof a === 'string')
  } catch {
    // keep empty
  }
  const track: Track = {
    id: trackId('local', row.native_id),
    provider: 'local',
    nativeId: row.native_id,
    title: row.title,
    artists,
    durationMs: row.duration_ms
  }
  if (row.album != null) track.album = row.album
  if (row.artwork_url != null) track.artworkUrl = row.artwork_url
  if (row.isrc != null) track.isrc = row.isrc
  if (row.local_path != null) track.localPath = row.local_path
  if (row.source_sc_id != null) track.sourceScId = row.source_sc_id
  return track
}

/** Local rows the scanner manages (downloads, which carry source_sc_id, are left alone). */
export function getScannedFiles(db: Db): LocalFileRow[] {
  return db
    .prepare(
      `SELECT native_id AS nativeId, local_path AS path, file_mtime_ms AS mtimeMs, file_size AS size
       FROM tracks
       WHERE provider = 'local' AND source_sc_id IS NULL AND local_path IS NOT NULL`
    )
    .all() as LocalFileRow[]
}

export function getLocalPath(db: Db, nativeId: string): string | undefined {
  return db
    .prepare(`SELECT local_path FROM tracks WHERE provider = 'local' AND native_id = ?`)
    .pluck()
    .get(nativeId) as string | undefined
}

export function upsertTracks(db: Db, records: readonly LocalTrackRecord[]): void {
  if (records.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO tracks (id, provider, native_id, title, artists, album, duration_ms, artwork_url,
                         isrc, local_path, track_no, disc_no, file_mtime_ms, file_size, art_hash)
     VALUES (@id, 'local', @nativeId, @title, @artists, @album, @durationMs, @artworkUrl,
             @isrc, @path, @trackNo, @discNo, @mtimeMs, @size, @artHash)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, artists = excluded.artists, album = excluded.album,
       duration_ms = excluded.duration_ms, artwork_url = excluded.artwork_url,
       isrc = excluded.isrc, local_path = excluded.local_path, track_no = excluded.track_no,
       disc_no = excluded.disc_no, file_mtime_ms = excluded.file_mtime_ms,
       file_size = excluded.file_size, art_hash = excluded.art_hash,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  )
  db.transaction(() => {
    for (const r of records) {
      stmt.run({
        id: trackId('local', r.nativeId),
        nativeId: r.nativeId,
        title: r.title,
        artists: JSON.stringify(r.artists),
        album: r.album ?? null,
        durationMs: r.durationMs,
        artworkUrl: r.artHash ? artworkUrl(r.artHash) : null,
        isrc: r.isrc ?? null,
        path: r.path,
        trackNo: r.trackNo ?? null,
        discNo: r.discNo ?? null,
        mtimeMs: r.mtimeMs,
        size: r.size,
        artHash: r.artHash ?? null
      })
    }
  })()
}

export function deleteLocalTracks(db: Db, nativeIds: readonly string[]): number {
  if (nativeIds.length === 0) return 0
  const stmt = db.prepare(`DELETE FROM tracks WHERE provider = 'local' AND native_id = ?`)
  let n = 0
  db.transaction(() => {
    for (const id of nativeIds) n += stmt.run(id).changes
  })()
  return n
}
