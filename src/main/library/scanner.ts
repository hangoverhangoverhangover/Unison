import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { setImmediate as yieldToLoop } from 'timers/promises'
import { parseFile, selectCover, type IPicture } from 'music-metadata'
import type { Db } from '../db'
import { isAudioFile, isUnder, nativeIdForPath } from './paths'
import {
  deleteLocalTracks,
  getScannedFiles,
  upsertTracks,
  type LocalFileRow,
  type LocalTrackRecord
} from './store'

const BATCH_SIZE = 50
const PARSE_CONCURRENCY = 4

export interface ScanOptions {
  db: Db
  folders: readonly string[]
  artworkDir: string
  onProgress?: (scanned: number, total: number) => void
  /** Checked between steps; when true the scan stops without touching the DB again. */
  isCancelled?: () => boolean
}

/** Recursively list audio files under a folder. Unreadable directories are skipped. */
export async function listAudioFiles(folder: string): Promise<string[]> {
  const out: string[] = []
  const stack = [folder]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[library] cannot read ${dir}:`, (err as Error).message)
      continue
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && isAudioFile(e.name)) out.push(full)
    }
  }
  return out
}

function artExt(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  return 'jpg'
}

/**
 * Write image bytes to `<artworkDir>/<sha1>.<ext>` once (temp file + rename); returns the
 * hash, which `media://art/<hash>` serves. Shared with playlist covers.
 */
export async function writeArtworkFile(
  data: Uint8Array,
  ext: string,
  artworkDir: string
): Promise<string> {
  const hash = createHash('sha1').update(data).digest('hex')
  const file = join(artworkDir, `${hash}.${ext}`)
  if (!existsSync(file)) {
    await mkdir(artworkDir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, data)
    try {
      await rename(tmp, file)
    } catch (err) {
      // Two files with the same embedded art can race here; on Windows the loser's
      // rename fails (EPERM/EEXIST) while the winner's file is in place. Same bytes, so keep it.
      await rm(tmp, { force: true })
      if (!existsSync(file)) throw err
    }
  }
  return hash
}

/** Write embedded art to `<artworkDir>/<sha1>.<ext>` once; returns the hash. */
function saveArtwork(picture: IPicture, artworkDir: string): Promise<string> {
  return writeArtworkFile(picture.data, artExt(picture.format), artworkDir)
}

function positiveInt(n: number | null | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

/** Stat and parse one file. Returns null (and logs) when it can't be read. */
export async function readTrack(
  path: string,
  artworkDir: string
): Promise<LocalTrackRecord | null> {
  try {
    const st = await stat(path)
    const { common, format } = await parseFile(path, { duration: true, skipCovers: false })
    const picture = selectCover(common.picture) ?? common.picture?.[0]
    const artists = common.artists?.length ? common.artists : common.artist ? [common.artist] : []
    const record: LocalTrackRecord = {
      nativeId: nativeIdForPath(path),
      path,
      title: common.title?.trim() || basename(path, extname(path)),
      artists,
      durationMs: format.duration ? Math.round(format.duration * 1000) : 0,
      mtimeMs: Math.floor(st.mtimeMs),
      size: st.size
    }
    if (common.album) record.album = common.album
    const trackNo = positiveInt(common.track?.no)
    if (trackNo) record.trackNo = trackNo
    const discNo = positiveInt(common.disk?.no)
    if (discNo) record.discNo = discNo
    if (common.isrc?.[0]) record.isrc = common.isrc[0]
    if (picture?.data?.length) record.artHash = await saveArtwork(picture, artworkDir)
    return record
  } catch (err) {
    console.warn(`[library] skipping ${path}:`, (err as Error).message)
    return null
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Incremental scan of every watched folder. Files whose mtime and size match
 * the DB are skipped; rows for files that are gone or outside every folder
 * are removed. Returns true if the DB changed.
 */
export async function scanLibrary(opts: ScanOptions): Promise<boolean> {
  const { db, folders, artworkDir, onProgress } = opts
  const cancelled = opts.isCancelled ?? (() => false)

  const files: string[] = []
  for (const folder of folders) {
    files.push(...(await listAudioFiles(folder)))
    if (cancelled()) return false
  }

  const known = new Map<string, LocalFileRow>()
  for (const row of getScannedFiles(db)) known.set(row.nativeId, row)

  const seen = new Set<string>()
  let changed = false
  let scanned = 0
  onProgress?.(0, files.length)

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const records = await mapLimit(batch, PARSE_CONCURRENCY, async (path) => {
      const id = nativeIdForPath(path)
      seen.add(id)
      const row = known.get(id)
      if (row && row.mtimeMs != null && row.size != null) {
        try {
          const st = await stat(path)
          if (Math.floor(st.mtimeMs) === row.mtimeMs && st.size === row.size) return null
        } catch {
          return null // vanished mid-scan; the removal pass handles it
        }
      }
      return readTrack(path, artworkDir)
    })
    if (cancelled()) return false
    const fresh = records.filter((r): r is LocalTrackRecord => r !== null)
    if (fresh.length > 0) {
      upsertTracks(db, fresh)
      changed = true
    }
    scanned += batch.length
    onProgress?.(scanned, files.length)
    await yieldToLoop()
  }

  if (cancelled()) return false
  // Re-read rows: the watcher may have added files while we were scanning.
  const stale = getScannedFiles(db)
    .filter(
      (row) =>
        !folders.some((f) => isUnder(row.path, f)) ||
        (!seen.has(row.nativeId) && !existsSync(row.path))
    )
    .map((row) => row.nativeId)
  if (deleteLocalTracks(db, stale) > 0) changed = true
  return changed
}

/** Re-read one file (watcher add/change). Returns true if the DB changed. */
export async function updateFile(
  db: Db,
  path: string,
  artworkDir: string,
  isCancelled: () => boolean = () => false
): Promise<boolean> {
  if (!isAudioFile(path)) return false
  const record = await readTrack(path, artworkDir)
  if (!record || isCancelled()) return false
  upsertTracks(db, [record])
  return true
}

/** Drop one file (watcher unlink). */
export function removeFile(db: Db, path: string): boolean {
  return deleteLocalTracks(db, [nativeIdForPath(path)]) > 0
}

/** Drop every scanned row under a directory (watcher unlinkDir). */
export function removeDir(db: Db, dir: string): boolean {
  const ids = getScannedFiles(db)
    .filter((row) => isUnder(row.path, dir))
    .map((row) => row.nativeId)
  return deleteLocalTracks(db, ids) > 0
}
