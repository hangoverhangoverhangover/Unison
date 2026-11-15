// The tag editor's logic, without Electron: validate track ids, write files (two at a time),
// re-read them into the library and report per-file results.
import { existsSync } from 'fs'
import { basename, extname } from 'path'
import type { FilenameTagProposal, TagFileResult } from '@shared/tags'
import type { Db } from '../db'
import { isUnder } from '../library/paths'
import { updateFile } from '../library/scanner'
import { getFolders } from '../library/store'
import {
  MAX_FIELD_LENGTH,
  normalizeEdit,
  checkEditForFile,
  type NormalizedEdit,
  type ResolveCover
} from './args'
import { verifyCoverImage, type CoverImage } from './cover'
import { parseFileName } from './filename'

const CONCURRENCY = 2
const MAX_BATCH = 10_000
const LOCAL_PREFIX = 'local:'

export type WriteFn = (path: string, edit: NormalizedEdit) => Promise<void>

export interface TagServiceOptions {
  db: Db
  artworkDir: string
  /** Rewrite one file (the real one runs ffmpeg). */
  write: WriteFn
  /** Re-read a file into the library DB (defaults to the scanner's updateFile). */
  reread?: (path: string) => Promise<boolean>
  /** Picked cover tokens (tags:pickCover); without it, cover tokens are refused. */
  resolveCover?: ResolveCover
  /** Re-check a picked image before a batch writes it (default: re-read and sniff it). */
  checkCover?: (image: CoverImage) => Promise<void>
  /** Called once per batch in which at least one file changed. */
  onLibraryChanged(): void
  log?: (message: string, err?: unknown) => void
}

export interface TagService {
  edit(trackIds: unknown, edit: unknown): Promise<TagFileResult[]>
  proposeFromFilenames(trackIds: unknown): FilenameTagProposal[]
  applyProposals(proposals: unknown): Promise<TagFileResult[]>
  dispose(): void
}

type Resolved = { ok: true; path: string } | { ok: false; error: string }

interface Job {
  trackId: string
  path: string
  edit: NormalizedEdit
}

function stringIds(trackIds: unknown): string[] {
  if (!Array.isArray(trackIds)) throw new Error('Expected a list of track ids')
  if (trackIds.length > MAX_BATCH) throw new Error(`Too many tracks (max ${MAX_BATCH})`)
  for (const id of trackIds) if (typeof id !== 'string') throw new Error('Invalid track id')
  return [...new Set(trackIds as string[])]
}

export function createTagService(opts: TagServiceOptions): TagService {
  const { db } = opts
  const log = opts.log ?? ((m, e) => console.warn(m, e ?? ''))
  const reread = opts.reread ?? ((path: string) => updateFile(db, path, opts.artworkDir))
  let disposed = false

  // Shared by every call: at most CONCURRENCY ffmpeg processes, one write per file at a time.
  let running = 0
  const waiting: (() => void)[] = []
  const fileLocks = new Map<string, Promise<void>>()

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r))
    running++
    try {
      return await fn()
    } finally {
      running--
      waiting.shift()?.()
    }
  }

  async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const key = path.toLowerCase()
    const prev = fileLocks.get(key) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const chained = prev.then(() => mine)
    fileLocks.set(key, chained)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (fileLocks.get(key) === chained) fileLocks.delete(key)
    }
  }

  const pathStmt = db.prepare(
    `SELECT local_path FROM tracks WHERE id = ? AND provider = 'local' AND local_path IS NOT NULL`
  )

  /** The file behind a local track id, if it's one we're allowed to rewrite. */
  function resolve(trackId: string): Resolved {
    if (!trackId.startsWith(LOCAL_PREFIX) || trackId.length === LOCAL_PREFIX.length)
      return { ok: false, error: 'Only local files can be tagged' }
    const path = pathStmt.pluck().get(trackId) as string | undefined
    if (!path) return { ok: false, error: 'Not in the local library' }
    if (!getFolders(db).some((folder) => isUnder(path, folder)))
      return { ok: false, error: "The file isn't inside one of your library folders" }
    if (!existsSync(path)) return { ok: false, error: 'The file is missing' }
    return { ok: true, path }
  }

  async function runJobs(jobs: readonly Job[]): Promise<TagFileResult[]> {
    let changed = false
    const results = await Promise.all(
      jobs.map(async (job): Promise<TagFileResult> => {
        try {
          await withFileLock(job.path, () =>
            slot(async () => {
              if (disposed) throw new Error('The app is closing')
              if (!existsSync(job.path)) throw new Error('The file is missing')
              await opts.write(job.path, job.edit)
            })
          )
        } catch (err) {
          log(`[tags] writing ${job.path} failed:`, err)
          return { trackId: job.trackId, ok: false, error: (err as Error).message || String(err) }
        }
        changed = true
        try {
          await reread(job.path)
        } catch (err) {
          // The file was written; the watcher or next scan will pick it up.
          log(`[tags] re-reading ${job.path} failed:`, err)
        }
        return { trackId: job.trackId, ok: true }
      })
    )
    if (changed && !disposed) opts.onLibraryChanged()
    return results
  }

  return {
    async edit(trackIds, rawEdit) {
      const ids = stringIds(trackIds)
      const edit = normalizeEdit(rawEdit, opts.resolveCover)
      if (edit.cover) await (opts.checkCover ?? verifyCoverImage)(edit.cover)
      const results: (TagFileResult | undefined)[] = []
      const jobs: Job[] = []
      const jobIndex: number[] = []
      ids.forEach((trackId, i) => {
        const r = resolve(trackId)
        const problem = r.ok ? checkEditForFile(r.path, edit) : r.error
        if (!r.ok || problem) {
          results[i] = { trackId, ok: false, error: problem ?? 'Invalid track' }
          return
        }
        jobs.push({ trackId, path: r.path, edit })
        jobIndex.push(i)
      })
      const done = await runJobs(jobs)
      done.forEach((res, j) => (results[jobIndex[j]!] = res))
      return results as TagFileResult[]
    },

    proposeFromFilenames(trackIds) {
      return stringIds(trackIds).map((trackId): FilenameTagProposal => {
        const r = resolve(trackId)
        if (!r.ok) return { trackId, fileName: '', skipped: r.error }
        const fileName = basename(r.path, extname(r.path))
        const parsed = parseFileName(fileName)
        if ('skipped' in parsed) return { trackId, fileName, skipped: parsed.skipped }
        if (parsed.artist.length > MAX_FIELD_LENGTH || parsed.title.length > MAX_FIELD_LENGTH)
          return { trackId, fileName, skipped: 'The file name is too long' }
        return { trackId, fileName, artist: parsed.artist, title: parsed.title }
      })
    },

    async applyProposals(proposals) {
      if (!Array.isArray(proposals)) throw new Error('Expected a list of proposals')
      if (proposals.length > MAX_BATCH) throw new Error(`Too many tracks (max ${MAX_BATCH})`)
      const results: (TagFileResult | undefined)[] = []
      const jobs: Job[] = []
      const jobIndex: number[] = []
      const seen = new Set<string>()
      proposals.forEach((raw: unknown, i) => {
        const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
        if (typeof p.trackId !== 'string') throw new Error('Invalid proposal')
        const trackId = p.trackId
        if (p.skipped !== undefined || seen.has(trackId)) return
        seen.add(trackId)
        const fail = (error: string): void => void (results[i] = { trackId, ok: false, error })
        if (typeof p.artist !== 'string' || typeof p.title !== 'string')
          return fail('Missing artist or title')
        let edit: NormalizedEdit
        try {
          edit = normalizeEdit({ artist: p.artist, title: p.title })
        } catch (err) {
          return fail((err as Error).message)
        }
        if (!edit.artist || !edit.title) return fail('Missing artist or title')
        const r = resolve(trackId)
        if (!r.ok) return fail(r.error)
        if (typeof p.fileName !== 'string' || basename(r.path, extname(r.path)) !== p.fileName)
          return fail('The file was renamed since the names were read')
        const problem = checkEditForFile(r.path, edit)
        if (problem) return fail(problem)
        jobs.push({ trackId, path: r.path, edit })
        jobIndex.push(i)
      })
      const done = await runJobs(jobs)
      done.forEach((res, j) => (results[jobIndex[j]!] = res))
      // Skipped proposals have no result.
      return results.filter((r): r is TagFileResult => r !== undefined)
    },

    dispose() {
      disposed = true
    }
  }
}
