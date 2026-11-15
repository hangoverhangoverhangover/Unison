// yt-dlp and ffmpeg: copied from the bundled bin folder into userData/bin (so yt-dlp can
// update itself without admin rights), then `yt-dlp -U` in the background.
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { ToolState } from '@shared/downloads'
import { runProcess, type SpawnFn } from './process'

export const YTDLP_EXE = 'yt-dlp.exe'
export const FFMPEG_EXE = 'ffmpeg.exe'
const TOOL_FILES = [YTDLP_EXE, FFMPEG_EXE] as const

const UPDATE_TIMEOUT_MS = 3 * 60_000
const VERSION_TIMEOUT_MS = 30_000

export interface ToolsSnapshot {
  state: ToolState
  version?: string
  error?: string
}

export interface ToolsOptions {
  bundledBinDir: string
  /** userData/bin */
  binDir: string
  spawn: SpawnFn
  onChange(snapshot: ToolsSnapshot): void
  log(message: string, err?: unknown): void
  /** Skip `yt-dlp -U` (tests). */
  skipUpdate?: boolean
}

export interface Tools {
  readonly snapshot: ToolsSnapshot
  readonly ytdlpPath: string
  readonly ffmpegPath: string
  /** Copy, update and read the version. Resolves when done (never rejects). */
  start(): Promise<void>
  /** Stop waiting on the update/version processes (they're left to finish on their own). */
  dispose(): void
}

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await stat(p)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

export function createTools(opts: ToolsOptions): Tools {
  const ytdlpPath = join(opts.binDir, YTDLP_EXE)
  const ffmpegPath = join(opts.binDir, FFMPEG_EXE)
  // 'copying' until start() has checked the files, so the queue waits for it.
  let snapshot: ToolsSnapshot = { state: 'copying' }
  let disposed = false

  function set(next: ToolsSnapshot): void {
    if (disposed) return
    snapshot = next
    opts.onChange(next)
  }

  async function copyMissing(): Promise<boolean> {
    await mkdir(opts.binDir, { recursive: true })
    // Leftovers from a copy interrupted by quitting.
    for (const name of await readdir(opts.binDir).catch(() => [] as string[])) {
      if (name.endsWith('.copying')) await rm(join(opts.binDir, name), { force: true })
    }
    const needed: string[] = []
    for (const name of TOOL_FILES) {
      if (!(await isFile(join(opts.binDir, name)))) needed.push(name)
    }
    if (needed.length === 0) return true
    const absent = needed.filter((n) => !existsSync(join(opts.bundledBinDir, n)))
    if (absent.length > 0) {
      set({ state: 'missing', error: `Not bundled with the app: ${absent.join(', ')}` })
      return false
    }
    set({ state: 'copying' })
    for (const name of needed) {
      const dest = join(opts.binDir, name)
      const tmp = `${dest}.${randomBytes(4).toString('hex')}.copying`
      try {
        await copyFile(join(opts.bundledBinDir, name), tmp)
        await rename(tmp, dest)
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => undefined)
        throw err
      }
    }
    return true
  }

  async function run(
    args: string[],
    timeoutMs: number
  ): Promise<{ code: number | null; out: string }> {
    const { child, done } = runProcess(opts.spawn, ytdlpPath, args)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    try {
      const r = await done
      return { code: r.code, out: `${r.stdout}${r.stderr}`.trim() }
    } finally {
      clearTimeout(timer)
    }
  }

  async function readVersion(): Promise<string | undefined> {
    try {
      const { code, out } = await run(['--version'], VERSION_TIMEOUT_MS)
      const v = out.split(/\r?\n/)[0]?.trim()
      return code === 0 && v ? v : undefined
    } catch (err) {
      opts.log('[downloads] yt-dlp --version failed:', err)
      return undefined
    }
  }

  return {
    get snapshot() {
      return snapshot
    },
    ytdlpPath,
    ffmpegPath,
    async start() {
      try {
        if (!(await copyMissing())) return
      } catch (err) {
        opts.log('[downloads] copying tools failed:', err)
        set({ state: 'error', error: `Couldn't install yt-dlp/ffmpeg: ${(err as Error).message}` })
        return
      }
      if (disposed) return
      let version = await readVersion()
      if (!opts.skipUpdate && !disposed) {
        set({ state: 'updating', ...(version ? { version } : {}) })
        try {
          const { code, out } = await run(['-U'], UPDATE_TIMEOUT_MS)
          if (code === 0) opts.log(`[downloads] yt-dlp -U: ${out.split(/\r?\n/).pop() ?? ''}`)
          else opts.log(`[downloads] yt-dlp -U failed (exit ${code}): ${out.slice(-500)}`)
        } catch (err) {
          opts.log('[downloads] yt-dlp -U failed:', err)
        }
        if (disposed) return
        version = (await readVersion()) ?? version
      }
      set({ state: 'ready', ...(version ? { version } : {}) })
    },
    dispose() {
      disposed = true
    }
  }
}
