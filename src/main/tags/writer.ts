// Write tags to one file: ffmpeg copies it with new metadata into a temp file next to it,
// then the temp file replaces the original.
import { randomBytes } from 'crypto'
import { rename as fsRename, rm as fsRm } from 'fs/promises'
import { runProcess, type SpawnFn } from '../downloads/process'
import { buildFfmpegArgs, type NormalizedEdit } from './args'

const FFMPEG_TIMEOUT_MS = 2 * 60_000
const RENAME_RETRIES = 4
const RENAME_RETRY_MS = 150
/** Windows reports a file someone else has open (indexer, antivirus, another player) this way. */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export interface ReplaceFs {
  rename(from: string, to: string): Promise<void>
  rm(path: string): Promise<void>
}

export const nodeReplaceFs: ReplaceFs = {
  rename: (from, to) => fsRename(from, to),
  rm: (path) => fsRm(path, { force: true })
}

export interface ReplaceOptions {
  fs?: ReplaceFs
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const randomSuffix = (): string => randomBytes(4).toString('hex')

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

/**
 * Move `tmp` over `target`. A plain rename replaces the file in one step (the original never
 * disappears, so the folder watcher sees a change, not a delete). Busy errors are retried; if
 * it still fails, `tmp` is removed and the original is left untouched.
 */
export async function replaceFile(
  tmp: string,
  target: string,
  opts: ReplaceOptions = {}
): Promise<void> {
  const fs = opts.fs ?? nodeReplaceFs
  const sleep = opts.sleep ?? defaultSleep
  let lastErr: unknown
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RENAME_RETRY_MS * attempt)
    try {
      await fs.rename(tmp, target)
      return
    } catch (err) {
      lastErr = err
      if (!BUSY_CODES.has(errCode(err) ?? '')) break
    }
  }

  // No backup-and-swap fallback: the original path must never be missing, or the library
  // watcher could drop the track row (and cascade its playlist entries and likes).
  await fs.rm(tmp).catch(() => undefined)
  throw inUseError(lastErr)
}

function inUseError(err: unknown): Error {
  const code = errCode(err)
  if (code && BUSY_CODES.has(code))
    return new Error('The file is in use by another program. Close it and try again.', {
      cause: err
    })
  return new Error(`Couldn't replace the file: ${(err as Error | undefined)?.message ?? err}`, {
    cause: err
  })
}

/** Turn ffmpeg's stderr into something short for the UI. */
export function ffmpegError(stderr: string, code: number | null): string {
  if (/Unsupported codec id in stream|codec not currently supported in container/i.test(stderr))
    return "ffmpeg can't keep this file's embedded cover art or extra streams in this format"
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  return last ? `ffmpeg failed: ${last.slice(0, 300)}` : `ffmpeg failed (exit ${code})`
}

export interface WriteDeps {
  ffmpegPath: string
  spawn: SpawnFn
  fs?: ReplaceFs
  sleep?: (ms: number) => Promise<void>
  random?: () => string
}

/** Rewrite one file's tags. Throws an Error with a readable message on failure. */
export async function writeTags(
  path: string,
  edit: NormalizedEdit,
  deps: WriteDeps
): Promise<void> {
  const fs = deps.fs ?? nodeReplaceFs
  // Not an audio extension, so the library's watcher and scanner ignore it.
  const tmp = `${path}.${(deps.random ?? randomSuffix)()}.tagtmp`
  const args = buildFfmpegArgs(path, tmp, edit)
  try {
    const { child, done } = runProcess(deps.spawn, deps.ffmpegPath, args)
    const timer = setTimeout(() => child.kill(), FFMPEG_TIMEOUT_MS)
    let result
    try {
      result = await done
    } finally {
      clearTimeout(timer)
    }
    if (result.code !== 0) throw new Error(ffmpegError(result.stderr, result.code))
  } catch (err) {
    await fs.rm(tmp).catch(() => undefined)
    if (errCode(err) === 'ENOENT')
      throw new Error(`ffmpeg not found at ${deps.ffmpegPath}`, { cause: err })
    throw err
  }
  await replaceFile(tmp, path, { fs, ...(deps.sleep ? { sleep: deps.sleep } : {}) })
}
