// One yt-dlp download: args, the temporary cookies file for the login, output parsing.
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { runProcess, type ChildLike, type SpawnFn } from './process'
import { parseFileLine, parseProgressLine, redact, ytdlpError } from './ytdlpOutput'

/**
 * yt-dlp's SoundCloud extractor accepts API track URLs, so no permalink lookup is needed.
 * Verified live with track 293 (Forss - Flickermood), yt-dlp 2026.10.26.
 */
export function trackUrl(scId: string): string {
  return `https://api.soundcloud.com/tracks/${scId}`
}

export const OUTPUT_TEMPLATE = '%(uploader)s - %(title)s [%(id)s].%(ext)s'

export function buildArgs(opts: {
  ffmpegPath: string
  folder: string
  scId: string
  cookiesFile?: string
}): string[] {
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    // --print implies --quiet, which hides progress; --progress brings it back.
    '--progress',
    '--no-warnings',
    '--color',
    'never',
    '--encoding',
    'utf-8',
    // Must be absolute: a relative path gave "ffmpeg not found".
    '--ffmpeg-location',
    opts.ffmpegPath,
    '--embed-metadata',
    '--embed-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '--windows-filenames',
    '--no-overwrites',
    '-P',
    opts.folder,
    '-o',
    OUTPUT_TEMPLATE,
    '--progress-template',
    'download:CP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
    '--print',
    'after_move:CPFILE %(filepath)s'
  ]
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile)
  args.push('--no-simulate', trackUrl(opts.scId))
  return args
}

/** Netscape cookies file holding only the SoundCloud oauth_token. */
export function cookiesFileContent(token: string): string {
  return `# Netscape HTTP Cookie File\n.soundcloud.com\tTRUE\t/\tTRUE\t0\toauth_token\t${token}\n`
}

export async function writeCookiesFile(tmpDir: string, token: string): Promise<string> {
  await mkdir(tmpDir, { recursive: true })
  const file = join(tmpDir, `sc-${randomBytes(12).toString('hex')}.txt`)
  await writeFile(file, cookiesFileContent(token), { mode: 0o600 })
  return file
}

/** True for yt-dlp's leftovers of an unfinished download (not the finished audio file). */
export function isPartialName(name: string): boolean {
  return /\.(part|ytdl|temp|tmp)$|\.part-Frag\d+|\.temp\.|\.(jpg|jpeg|webp|png)$/i.test(name)
}

/** Delete unfinished files for this track (`... [<scId>].*` partials) in the folder. */
export async function removePartials(folder: string, scId: string): Promise<void> {
  if (!existsSync(folder)) return
  const tag = `[${scId}]`
  const names = await readdir(folder).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((n) => n.includes(tag) && isPartialName(n))
      .map((n) => rm(join(folder, n), { force: true }).catch(() => undefined))
  )
}

export class YtdlpError extends Error {}

export interface YtdlpRun {
  /** Resolves with the final file path. Rejects with YtdlpError (readable message). */
  done: Promise<string>
  child: ChildLike
}

export async function startYtdlp(opts: {
  spawn: SpawnFn
  ytdlpPath: string
  ffmpegPath: string
  folder: string
  scId: string
  token?: string
  tmpDir: string
  onProgress(progress: number): void
}): Promise<YtdlpRun> {
  const cookiesFile = opts.token ? await writeCookiesFile(opts.tmpDir, opts.token) : undefined
  const cleanup = async (): Promise<void> => {
    if (cookiesFile) await rm(cookiesFile, { force: true }).catch(() => undefined)
  }
  let filePath: string | undefined
  let handle
  try {
    handle = runProcess(
      opts.spawn,
      opts.ytdlpPath,
      buildArgs({ ffmpegPath: opts.ffmpegPath, folder: opts.folder, scId: opts.scId, cookiesFile }),
      (line) => {
        const p = parseProgressLine(line)
        if (p !== undefined) opts.onProgress(p)
        const f = parseFileLine(line)
        if (f) filePath = f
      }
    )
  } catch (err) {
    await cleanup()
    throw err
  }
  const done = handle.done.then(
    async ({ code, stderr }) => {
      await cleanup()
      if (code === 0 && filePath && existsSync(filePath)) return filePath
      const clean = redact(stderr, [opts.token])
      if (code === 0) throw new YtdlpError("yt-dlp finished but the file wasn't found.")
      throw new YtdlpError(ytdlpError(clean, code))
    },
    async (err: Error) => {
      await cleanup()
      throw new YtdlpError(`Couldn't start yt-dlp: ${redact(err.message, [opts.token])}`)
    }
  )
  return { done, child: handle.child }
}
