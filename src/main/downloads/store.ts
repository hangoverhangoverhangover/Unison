// downloads table access and the download-folder setting.
import type { DownloadItem, DownloadMethod, DownloadStatus } from '@shared/downloads'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { rowToTrack, trackColumns, type TrackRow } from '../db/tracks'

/** settings key for the download folder (JSON string). */
export const FOLDER_KEY = 'downloads.folder'

export interface DownloadRow {
  id: number
  sc_track_id: string
  track_id: string | null
  method: DownloadMethod | null
  status: DownloadStatus
  progress: number
  file_path: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

const ROW_COLUMNS =
  'd.id, d.sc_track_id, d.track_id, d.method, d.status, d.progress, d.file_path, d.error, d.created_at, d.finished_at'

type JoinedRow = DownloadRow & { [K in keyof TrackRow as `t_${K}`]: TrackRow[K] | null }

const JOINED_SELECT = `SELECT ${ROW_COLUMNS}, ${trackColumns('t')
  .split(', ')
  .map((c) => `${c} AS t_${c.slice(2)}`)
  .join(', ')}
  FROM downloads d LEFT JOIN tracks t ON t.id = 'soundcloud:' || d.sc_track_id`

/** Placeholder when the SoundCloud track row is gone (shouldn't happen: it's stored at enqueue). */
function fallbackTrack(scId: string): Track {
  return {
    id: `soundcloud:${scId}`,
    provider: 'soundcloud',
    nativeId: scId,
    title: `SoundCloud track ${scId}`,
    artists: [],
    durationMs: 0
  }
}

function toItem(r: JoinedRow): DownloadItem {
  const track =
    r.t_id === null
      ? fallbackTrack(r.sc_track_id)
      : rowToTrack({
          id: r.t_id,
          provider: r.t_provider!,
          native_id: r.t_native_id!,
          title: r.t_title!,
          artists: r.t_artists!,
          album: r.t_album,
          duration_ms: r.t_duration_ms ?? 0,
          artwork_url: r.t_artwork_url,
          isrc: r.t_isrc,
          local_path: r.t_local_path,
          source_sc_id: r.t_source_sc_id,
          availability: r.t_availability,
          url: r.t_url,
          artist_refs: r.t_artist_refs,
          album_ref: r.t_album_ref
        })
  const item: DownloadItem = {
    id: r.id,
    scTrackId: r.sc_track_id,
    track,
    status: r.status,
    progress: r.progress,
    createdAt: r.created_at
  }
  if (r.method) item.method = r.method
  if (r.file_path) item.filePath = r.file_path
  if (r.track_id) item.localTrackId = r.track_id
  if (r.error) item.error = r.error
  if (r.finished_at) item.finishedAt = r.finished_at
  return item
}

export interface DownloadsStore {
  get(id: number): DownloadRow | undefined
  getItem(id: number): DownloadItem | undefined
  /** Active first (running, then queued, by id), then history newest first. */
  list(): DownloadItem[]
  /** Latest row for a SoundCloud track, preferring active rows. */
  findActive(scId: string): DownloadRow | undefined
  findDone(scId: string): DownloadRow[]
  insert(scId: string): number
  nextQueued(exclude: ReadonlySet<number>): DownloadRow | undefined
  setRunning(id: number): void
  setMethod(id: number, method: DownloadMethod): void
  setProgress(id: number, progress: number): void
  setQueued(id: number): void
  setFailed(id: number, error: string): void
  setDone(id: number, filePath: string, localTrackId: string): void
  /** Rows left running/queued by a previous session go back to queued. Returns the count. */
  requeueInterrupted(): number
  doneRows(): DownloadRow[]
  clearHistory(): number
  getFolder(fallback: string): string
  setFolder(folder: string): void
}

const now = (): string => new Date().toISOString()

export function createDownloadsStore(db: Db): DownloadsStore {
  const byId = db.prepare(`SELECT ${ROW_COLUMNS} FROM downloads d WHERE d.id = ?`)
  const itemById = db.prepare(`${JOINED_SELECT} WHERE d.id = ?`)
  const listAll = db.prepare(
    `${JOINED_SELECT}
     ORDER BY CASE d.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
              CASE WHEN d.status IN ('running', 'queued') THEN d.id END ASC,
              COALESCE(d.finished_at, d.created_at) DESC, d.id DESC`
  )
  const active = db.prepare(
    `SELECT ${ROW_COLUMNS} FROM downloads d
     WHERE d.sc_track_id = ? AND d.status IN ('queued', 'running') ORDER BY d.id LIMIT 1`
  )
  const done = db.prepare(
    `SELECT ${ROW_COLUMNS} FROM downloads d
     WHERE d.sc_track_id = ? AND d.status = 'done' ORDER BY d.id DESC`
  )
  const queued = db.prepare(
    `SELECT ${ROW_COLUMNS} FROM downloads d WHERE d.status = 'queued' ORDER BY d.id`
  )
  const allDone = db.prepare(`SELECT ${ROW_COLUMNS} FROM downloads d WHERE d.status = 'done'`)

  return {
    get: (id) => byId.get(id) as DownloadRow | undefined,
    getItem(id) {
      const r = itemById.get(id) as JoinedRow | undefined
      return r ? toItem(r) : undefined
    },
    list: () => (listAll.all() as JoinedRow[]).map(toItem),
    findActive: (scId) => active.get(scId) as DownloadRow | undefined,
    findDone: (scId) => done.all(scId) as DownloadRow[],
    insert(scId) {
      const info = db
        .prepare(`INSERT INTO downloads (sc_track_id, status, progress) VALUES (?, 'queued', 0)`)
        .run(scId)
      return Number(info.lastInsertRowid)
    },
    nextQueued(exclude) {
      for (const r of queued.iterate() as IterableIterator<DownloadRow>) {
        if (!exclude.has(r.id)) return r
      }
      return undefined
    },
    setRunning(id) {
      db.prepare(
        `UPDATE downloads SET status = 'running', progress = 0, error = NULL, method = NULL,
                finished_at = NULL WHERE id = ?`
      ).run(id)
    },
    setMethod(id, method) {
      db.prepare('UPDATE downloads SET method = ? WHERE id = ?').run(method, id)
    },
    setProgress(id, progress) {
      db.prepare('UPDATE downloads SET progress = ? WHERE id = ?').run(
        Math.min(1, Math.max(0, progress)),
        id
      )
    },
    setQueued(id) {
      db.prepare(
        `UPDATE downloads SET status = 'queued', progress = 0, error = NULL, finished_at = NULL
         WHERE id = ?`
      ).run(id)
    },
    setFailed(id, error) {
      db.prepare(
        `UPDATE downloads SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`
      ).run(error, now(), id)
    },
    setDone(id, filePath, localTrackId) {
      db.prepare(
        `UPDATE downloads SET status = 'done', progress = 1, error = NULL, file_path = ?,
                track_id = ?, finished_at = ? WHERE id = ?`
      ).run(filePath, localTrackId, now(), id)
    },
    requeueInterrupted() {
      return db
        .prepare(
          `UPDATE downloads SET status = 'queued', progress = 0, error = NULL
           WHERE status IN ('running', 'queued')`
        )
        .run().changes
    },
    doneRows: () => allDone.all() as DownloadRow[],
    clearHistory() {
      return db.prepare(`DELETE FROM downloads WHERE status IN ('done', 'failed')`).run().changes
    },
    getFolder(fallback) {
      const value = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .pluck()
        .get(FOLDER_KEY) as string | undefined
      if (!value) return fallback
      try {
        const parsed: unknown = JSON.parse(value)
        return typeof parsed === 'string' && parsed.trim() ? parsed : fallback
      } catch {
        return fallback
      }
    },
    setFolder(folder) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      ).run(FOLDER_KEY, JSON.stringify(folder))
    }
  }
}
