// The download queue (Phase 7): official file first, yt-dlp otherwise, two at a time.
// No Electron imports: index.ts wires this to IPC; tests drive it with fakes.
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { basename, extname, join } from 'path'
import {
  MAX_CONCURRENT_DOWNLOADS,
  type DownloaderStatus,
  type DownloadItem
} from '@shared/downloads'
import type { SoundCloudProvider } from '@shared/provider'
import { trackId, type Track } from '@shared/types'
import type { Db } from '../db'
import { upsertServiceTracks } from '../db/tracks'
import { nativeIdForPath } from '../library/paths'
import { readTrack as defaultReadTrack } from '../library/scanner'
import { upsertTracks, type LocalTrackRecord } from '../library/store'
import { fetchToFile, type FetchFn } from './fetchFile'
import { officialExtension, officialFileName, uniquePath } from './naming'
import {
  defaultKillTree,
  defaultSpawn,
  type ChildLike,
  type KillTreeFn,
  type SpawnFn
} from './process'
import { createDownloadsStore, type DownloadRow, type DownloadsStore } from './store'
import { createTools, type Tools, type ToolsSnapshot } from './tools'
import { removePartials, startYtdlp } from './ytdlp'
import { PREVIEW_ERROR, redact } from './ytdlpOutput'

export const CANCELLED = 'Cancelled'
const PROGRESS_EMIT_MS = 250
const PROGRESS_PERSIST_MS = 2000
/** A file shorter than this share of the SoundCloud duration is a preview. */
const PREVIEW_RATIO = 0.9

export interface DownloaderDeps {
  db: Db
  userDataDir: string
  bundledBinDir: string
  defaultFolder: string
  soundcloud: Pick<SoundCloudProvider, 'getOfficialDownload'>
  getSoundCloudToken(): Promise<string | undefined>
  onStatus(status: DownloaderStatus): void
  onChanged(): void
  onProgress(id: number, progress: number): void
  onLibraryChanged(): void
  revealFile(path: string): void
  spawn?: SpawnFn
  killTree?: KillTreeFn
  fetch?: FetchFn
  readTrack?: (path: string, artworkDir: string) => Promise<LocalTrackRecord | null>
  log?: (message: string, err?: unknown) => void
  /** Skip `yt-dlp -U` (tests). */
  skipUpdate?: boolean
}

export interface Downloader {
  /** Start tools setup, startup recovery and the queue. */
  start(): Promise<void>
  getStatus(): DownloaderStatus
  list(): DownloadItem[]
  enqueue(track: Track): DownloadItem
  /**
   * `enqueue` for a batch: non-SoundCloud (and malformed) tracks are skipped, repeats
   * in the batch collapse to one. One item per accepted track, one onChanged at most.
   */
  enqueueMany(tracks: Track[]): DownloadItem[]
  retry(id: number): DownloadItem
  cancel(id: number): Promise<void>
  clearHistory(): void
  setFolder(folder: string): Promise<DownloaderStatus>
  reveal(id: number): void
  /** Resolves when every running download has settled (tests). */
  idle(): Promise<void>
  dispose(): Promise<void>
}

interface Job {
  id: number
  abort: AbortController
  child?: ChildLike
  /** 'cancel': ends failed "Cancelled". 'shutdown': back to queued for next launch. */
  stop?: 'cancel' | 'shutdown'
  progress: number
  lastEmit: number
  lastPersist: number
  partials: Set<string>
  promise?: Promise<void>
}

class StoppedError extends Error {}

function assertScTrack(track: Track): void {
  if (!track || typeof track !== 'object') throw new Error('Not a track.')
  if (track.provider !== 'soundcloud') throw new Error('Only SoundCloud tracks can be downloaded.')
  if (typeof track.nativeId !== 'string' || !/^\d+$/.test(track.nativeId))
    throw new Error(`Not a SoundCloud track id: ${String(track.nativeId)}`)
  if (track.id !== trackId('soundcloud', track.nativeId))
    throw new Error('Track id and native id disagree.')
  if (typeof track.title !== 'string') throw new Error('Track has no title.')
}

export function createDownloader(deps: DownloaderDeps): Downloader {
  const store: DownloadsStore = createDownloadsStore(deps.db)
  const log =
    deps.log ??
    ((message: string, err?: unknown) =>
      err === undefined ? console.log(message) : console.warn(message, err))
  const spawn = deps.spawn ?? defaultSpawn
  const killTree = deps.killTree ?? defaultKillTree
  const fetchFn: FetchFn = deps.fetch ?? ((url, init) => fetch(url, init))
  const readTrack = deps.readTrack ?? defaultReadTrack
  const artworkDir = join(deps.userDataDir, 'artwork')
  const tmpDir = join(deps.userDataDir, 'tmp')
  const jobs = new Map<number, Job>()
  let disposed = false
  let started = false

  const tools: Tools = createTools({
    bundledBinDir: deps.bundledBinDir,
    binDir: join(deps.userDataDir, 'bin'),
    spawn,
    log,
    skipUpdate: deps.skipUpdate,
    onChange: () => {
      deps.onStatus(getStatus())
      pump()
    }
  })

  function getStatus(): DownloaderStatus {
    const t: ToolsSnapshot = tools.snapshot
    const s: DownloaderStatus = { tools: t.state, folder: store.getFolder(deps.defaultFolder) }
    if (t.version) s.ytdlpVersion = t.version
    if (t.error) s.error = t.error
    return s
  }

  function item(id: number): DownloadItem {
    const it = store.getItem(id)
    if (!it) throw new Error(`No download ${id}.`)
    return it
  }

  /** The SoundCloud track stored at enqueue. */
  function scTrack(row: DownloadRow): Track {
    return item(row.id).track
  }

  function setProgress(job: Job, p: number): void {
    // Monotonic: yt-dlp can restart a format, which would make the bar jump back.
    if (p <= job.progress) return
    job.progress = p
    const now = Date.now()
    if (now - job.lastEmit >= PROGRESS_EMIT_MS) {
      job.lastEmit = now
      deps.onProgress(job.id, p)
    }
    if (now - job.lastPersist >= PROGRESS_PERSIST_MS) {
      job.lastPersist = now
      store.setProgress(job.id, p)
    }
  }

  function throwIfStopped(job: Job): void {
    if (job.stop) throw new StoppedError(job.stop)
  }

  async function officialDownload(
    job: Job,
    row: DownloadRow,
    track: Track
  ): Promise<string | null> {
    let official
    try {
      official = await deps.soundcloud.getOfficialDownload(row.sc_track_id)
    } catch (err) {
      throwIfStopped(job)
      log(`[downloads] no official download for ${row.sc_track_id}: ${(err as Error).message}`)
      return null
    }
    throwIfStopped(job)
    if (!official) return null
    store.setMethod(job.id, 'official')
    deps.onChanged()
    const folder = store.getFolder(deps.defaultFolder)
    await mkdir(folder, { recursive: true })
    try {
      return await fetchToFile({
        fetch: fetchFn,
        url: official.url,
        signal: job.abort.signal,
        pickDest: ({ contentType }) =>
          uniquePath(
            folder,
            officialFileName(
              track.artists,
              track.title,
              row.sc_track_id,
              officialExtension(official.filename, contentType)
            )
          ),
        onProgress: (p) => setProgress(job, p),
        onPartial: (p) => job.partials.add(p)
      })
    } catch (err) {
      throwIfStopped(job)
      log(`[downloads] official download failed for ${row.sc_track_id}, trying yt-dlp:`, err)
      return null
    }
  }

  async function ytdlpDownload(job: Job, row: DownloadRow): Promise<string> {
    store.setMethod(job.id, 'ytdlp')
    deps.onChanged()
    const t = tools.snapshot
    if (t.state !== 'ready') {
      throw new Error(
        t.error ? `yt-dlp isn't available: ${t.error}` : "yt-dlp isn't available. Restart the app."
      )
    }
    const folder = store.getFolder(deps.defaultFolder)
    await mkdir(folder, { recursive: true })
    const token = await deps.getSoundCloudToken().catch(() => undefined)
    throwIfStopped(job)
    const run = await startYtdlp({
      spawn,
      ytdlpPath: tools.ytdlpPath,
      ffmpegPath: tools.ffmpegPath,
      folder,
      scId: row.sc_track_id,
      token,
      tmpDir,
      onProgress: (p) => setProgress(job, p)
    })
    job.child = run.child
    if (job.stop) killTree(run.child)
    try {
      return await run.done
    } catch (err) {
      await removePartials(folder, row.sc_track_id)
      throwIfStopped(job)
      throw err
    } finally {
      job.child = undefined
    }
  }

  /** Add the finished file to the library, linked to its SoundCloud original. */
  async function addToLibrary(
    job: Job,
    row: DownloadRow,
    track: Track,
    path: string
  ): Promise<void> {
    const record = await readTrack(path, artworkDir)
    if (!record) throw new Error("The downloaded file couldn't be read.")
    if (
      track.durationMs > 0 &&
      record.durationMs > 0 &&
      record.durationMs < track.durationMs * PREVIEW_RATIO
    ) {
      await rm(path, { force: true }).catch(() => undefined)
      throw new Error(PREVIEW_ERROR)
    }
    throwIfStopped(job)
    // Official originals often have no tags; readTrack then falls back to the file name.
    if (!record.title.trim() || record.title === basename(path, extname(path)))
      record.title = track.title
    if (record.artists.length === 0) record.artists = [...track.artists]
    if (!record.album && track.album) record.album = track.album
    const localId = trackId('local', record.nativeId || nativeIdForPath(path))
    deps.db.transaction(() => {
      upsertTracks(deps.db, [record])
      deps.db
        .prepare('UPDATE tracks SET source_sc_id = ? WHERE id = ?')
        .run(row.sc_track_id, localId)
      store.setDone(job.id, path, localId)
    })()
  }

  async function runJob(job: Job): Promise<void> {
    const row = store.get(job.id)
    if (!row) return
    const track = scTrack(row)
    let path: string | null = null
    try {
      path = await officialDownload(job, row, track)
      if (path === null) path = await ytdlpDownload(job, row)
      throwIfStopped(job)
      await addToLibrary(job, row, track, path)
      deps.onChanged()
      deps.onLibraryChanged()
    } catch (err) {
      for (const p of job.partials) await rm(p, { force: true }).catch(() => undefined)
      if (job.stop === 'shutdown') {
        if (path) await rm(path, { force: true }).catch(() => undefined)
        store.setQueued(job.id)
      } else if (job.stop === 'cancel') {
        if (path) await rm(path, { force: true }).catch(() => undefined)
        store.setFailed(job.id, CANCELLED)
        deps.onChanged()
      } else {
        const clean = redact(err instanceof Error ? err.message : String(err))
        log(`[downloads] ${row.sc_track_id} failed: ${clean}`)
        store.setFailed(job.id, clean || 'Download failed.')
        deps.onChanged()
      }
    }
  }

  function canRun(): boolean {
    const state = tools.snapshot.state
    // Wait while the tools are being copied or yt-dlp is replacing itself.
    return started && !disposed && state !== 'copying' && state !== 'updating'
  }

  function pump(): void {
    if (!canRun()) return
    while (jobs.size < MAX_CONCURRENT_DOWNLOADS) {
      const next = store.nextQueued(new Set(jobs.keys()))
      if (!next) return
      const job: Job = {
        id: next.id,
        abort: new AbortController(),
        progress: 0,
        lastEmit: 0,
        lastPersist: Date.now(),
        partials: new Set()
      }
      jobs.set(job.id, job)
      store.setRunning(job.id)
      deps.onChanged()
      job.promise = runJob(job).finally(() => {
        jobs.delete(job.id)
        pump()
      })
    }
  }

  function stopJob(job: Job, reason: 'cancel' | 'shutdown'): void {
    job.stop = reason
    job.abort.abort()
    if (job.child) killTree(job.child)
  }

  function cleanMissingFiles(): void {
    let removed = 0
    const del = deps.db.prepare(
      `DELETE FROM tracks
       WHERE provider = 'local' AND source_sc_id = ? AND local_path = ?`
    )
    for (const r of store.doneRows()) {
      if (r.file_path && !existsSync(r.file_path))
        removed += del.run(r.sc_track_id, r.file_path).changes
    }
    if (removed > 0) {
      log(`[downloads] removed ${removed} library row(s) for deleted downloads`)
      deps.onLibraryChanged()
    }
  }

  /** Existing active/finished download for the track, or a new queued row. */
  function add(track: Track): { id: number; inserted: boolean } {
    assertScTrack(track)
    const scId = track.nativeId
    const active = store.findActive(scId)
    if (active) return { id: active.id, inserted: false }
    const done = store.findDone(scId).find((r) => r.file_path && existsSync(r.file_path))
    if (done) return { id: done.id, inserted: false }
    upsertServiceTracks(deps.db, [track])
    return { id: store.insert(scId), inserted: true }
  }

  return {
    async start() {
      if (started) return
      started = true
      const requeued = store.requeueInterrupted()
      if (requeued > 0) log(`[downloads] resuming ${requeued} download(s)`)
      cleanMissingFiles()
      deps.onStatus(getStatus())
      await tools.start()
      pump()
    },
    getStatus,
    list: () => store.list(),
    enqueue(track) {
      if (disposed) throw new Error('The downloader is shutting down.')
      const { id, inserted } = add(track)
      if (inserted) {
        deps.onChanged()
        pump()
      }
      return item(id)
    },
    enqueueMany(tracks) {
      if (disposed) throw new Error('The downloader is shutting down.')
      const seen = new Set<string>()
      const ids: number[] = []
      let inserted = 0
      deps.db.transaction(() => {
        for (const track of Array.isArray(tracks) ? tracks : []) {
          if (track?.provider !== 'soundcloud') continue
          try {
            assertScTrack(track)
          } catch (err) {
            log(`[downloads] skipped ${String(track.id)}`, err)
            continue
          }
          if (seen.has(track.nativeId)) continue
          seen.add(track.nativeId)
          const r = add(track)
          ids.push(r.id)
          if (r.inserted) inserted++
        }
      })()
      if (inserted > 0) {
        deps.onChanged()
        pump()
      }
      return ids.map(item)
    },
    retry(id) {
      const row = store.get(id)
      if (!row) throw new Error(`No download ${id}.`)
      if (row.status !== 'failed') throw new Error('Only failed downloads can be retried.')
      // Already queued again from the track itself: don't run it twice.
      const active = store.findActive(row.sc_track_id)
      if (active) return item(active.id)
      store.setQueued(id)
      deps.onChanged()
      pump()
      return item(id)
    },
    async cancel(id) {
      const job = jobs.get(id)
      if (job) {
        stopJob(job, 'cancel')
        await job.promise
        return
      }
      const row = store.get(id)
      if (row?.status === 'queued') {
        store.setFailed(id, CANCELLED)
        deps.onChanged()
      }
    },
    clearHistory() {
      if (store.clearHistory() > 0) deps.onChanged()
    },
    async setFolder(folder) {
      await mkdir(folder, { recursive: true })
      store.setFolder(folder)
      const status = getStatus()
      deps.onStatus(status)
      return status
    },
    reveal(id) {
      const row = store.get(id)
      if (row?.status === 'done' && row.file_path) deps.revealFile(row.file_path)
    },
    async idle() {
      while (jobs.size > 0) await Promise.all([...jobs.values()].map((j) => j.promise))
    },
    async dispose() {
      if (disposed) return
      disposed = true
      tools.dispose()
      const running = [...jobs.values()]
      for (const job of running) stopJob(job, 'shutdown')
      await Promise.all(running.map((j) => j.promise))
    }
  }
}
