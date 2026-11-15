import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloaderStatus } from '@shared/downloads'
import type { OfficialDownload } from '@shared/provider'
import type { Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { nativeIdForPath } from '../library/paths'
import type { LocalTrackRecord } from '../library/store'
import { CANCELLED, createDownloader, type Downloader, type DownloaderDeps } from './manager'
import type { ChildLike, SpawnFn } from './process'
import { DRM_ERROR, PREVIEW_ERROR } from './ytdlpOutput'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  closed = false
  constructor(readonly args: readonly string[]) {
    super()
  }
  line(text: string): void {
    this.stdout.write(`${text}\n`)
  }
  finish(code: number | null, stderr = ''): void {
    if (this.closed) return
    this.closed = true
    if (stderr) this.stderr.write(stderr)
    this.stdout.end()
    this.stderr.end()
    setTimeout(() => this.emit('close', code), 5)
  }
  kill(): boolean {
    this.killed = true
    this.finish(null)
    return true
  }
}

const TOKEN = '2-111111-2222222-SeCrEtToKeN'

function scTrack(id: string, durationMs = 200_000): Track {
  return {
    id: `soundcloud:${id}`,
    provider: 'soundcloud',
    nativeId: id,
    title: `Title ${id}`,
    artists: ['Artist'],
    durationMs
  }
}

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await tick(5)
  }
}

describe('downloader', () => {
  let dir: string
  let userData: string
  let bundled: string
  let folder: string
  let db: Db
  let downloads: FakeChild[]
  let onDownload: (child: FakeChild) => void
  let official: (id: string) => Promise<OfficialDownload | null>
  let token: string | undefined
  let fileDurationMs: number | undefined
  let statuses: DownloaderStatus[]
  let changed: number
  let libraryChanged: number
  let progress: Array<{ id: number; progress: number }>
  let dl: Downloader | undefined

  const spawn: SpawnFn = (_cmd, args) => {
    const child = new FakeChild(args)
    if (args[0] === '--version') {
      setTimeout(() => {
        child.line('2026.10.26')
        child.finish(0)
      }, 1)
    } else if (args[0] === '-U') {
      setTimeout(() => {
        child.line('yt-dlp is up to date (stable@2026.10.26 from yt-dlp/yt-dlp)')
        child.finish(0)
      }, 1)
    } else {
      downloads.push(child)
      setTimeout(() => onDownload(child), 1)
    }
    return child
  }

  /** A yt-dlp run that writes the file and reports it. */
  function succeed(child: FakeChild): void {
    const args = child.args
    const out = args[args.indexOf('-P') + 1]!
    const id = args.at(-1)!.split('/').pop()!
    const path = join(out, `Artist - Title ${id} [${id}].m4a`)
    writeFileSync(path, 'audio')
    child.line('CP 1785 NA 2236663.0')
    child.line('CP 4320403 4320403 NA')
    child.line(`CPFILE ${path}`)
    child.finish(0)
  }

  function make(extra: Partial<DownloaderDeps> = {}): Downloader {
    dl = createDownloader({
      db,
      userDataDir: userData,
      bundledBinDir: bundled,
      defaultFolder: folder,
      soundcloud: { getOfficialDownload: (id) => official(id) },
      getSoundCloudToken: async () => token,
      onStatus: (s) => statuses.push(s),
      onChanged: () => changed++,
      onProgress: (id, p) => progress.push({ id, progress: p }),
      onLibraryChanged: () => libraryChanged++,
      revealFile: vi.fn(),
      spawn,
      killTree: (c) => c.kill(),
      readTrack: async (path): Promise<LocalTrackRecord> => ({
        nativeId: nativeIdForPath(path),
        path,
        title: path
          .split(/[\\/]/)
          .pop()!
          .replace(/\.[^.]+$/, ''),
        artists: [],
        durationMs: fileDurationMs ?? 200_000,
        mtimeMs: 1,
        size: 5
      }),
      log: () => undefined,
      ...extra
    })
    return dl
  }

  function row(id: number): Record<string, unknown> {
    return db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as Record<string, unknown>
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dl-'))
    userData = join(dir, 'userData')
    bundled = join(dir, 'bundled')
    folder = join(dir, 'Music', 'Combined Player')
    mkdirSync(bundled, { recursive: true })
    writeFileSync(join(bundled, 'yt-dlp.exe'), 'ytdlp')
    writeFileSync(join(bundled, 'ffmpeg.exe'), 'ffmpeg')
    db = openDb(':memory:')
    downloads = []
    onDownload = succeed
    official = async () => null
    token = undefined
    fileDurationMs = undefined
    statuses = []
    changed = 0
    libraryChanged = 0
    progress = []
    dl = undefined
  })

  afterEach(async () => {
    await dl?.dispose()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('copies the tools into userData/bin, updates, then reports ready with the version', async () => {
    const d = make()
    await d.start()
    expect(readFileSync(join(userData, 'bin', 'yt-dlp.exe'), 'utf8')).toBe('ytdlp')
    expect(readFileSync(join(userData, 'bin', 'ffmpeg.exe'), 'utf8')).toBe('ffmpeg')
    const states = statuses.map((s) => s.tools)
    expect(states).toContain('copying')
    expect(states).toContain('updating')
    expect(d.getStatus()).toEqual({ tools: 'ready', ytdlpVersion: '2026.10.26', folder })
  })

  it('reports missing when the bundled tools are absent', async () => {
    rmSync(join(bundled, 'ffmpeg.exe'))
    const d = make()
    await d.start()
    expect(d.getStatus().tools).toBe('missing')
  })

  it('rejects non-SoundCloud tracks', () => {
    const d = make()
    expect(() => d.enqueue({ ...scTrack('1'), id: 'spotify:1', provider: 'spotify' })).toThrow(
      /Only SoundCloud/
    )
  })

  it('dedupes queued tracks and finished tracks whose file exists', async () => {
    const d = make()
    const a = d.enqueue(scTrack('10'))
    expect(d.enqueue(scTrack('10')).id).toBe(a.id)
    expect(a.status).toBe('queued')
    expect(a.track.title).toBe('Title 10')
    await d.start()
    await until(() => row(a.id).status === 'done')
    expect(d.enqueue(scTrack('10')).id).toBe(a.id)
    // File gone: a new download.
    rmSync(row(a.id).file_path as string)
    const b = d.enqueue(scTrack('10'))
    expect(b.id).not.toBe(a.id)
    await d.idle()
  })

  it('enqueueMany skips non-SoundCloud tracks, dedupes, and signals once', () => {
    const d = make()
    const existing = d.enqueue(scTrack('10'))
    changed = 0
    const spotify: Track = { ...scTrack('1'), id: 'spotify:1', provider: 'spotify' }
    const bad: Track = { ...scTrack('2'), id: 'soundcloud:3' }
    const items = d.enqueueMany([
      scTrack('11'),
      spotify,
      scTrack('10'),
      scTrack('11'),
      bad,
      scTrack('12')
    ])
    expect(items.map((i) => i.scTrackId)).toEqual(['11', '10', '12'])
    expect(items[1]!.id).toBe(existing.id)
    expect(items.every((i) => i.status === 'queued')).toBe(true)
    expect(changed).toBe(1)
    expect(d.list()).toHaveLength(3)
    // Nothing new: no change signal.
    d.enqueueMany([scTrack('12'), spotify])
    expect(changed).toBe(1)
    expect(d.enqueueMany([])).toEqual([])
  })

  it('runs at most two downloads at a time, FIFO', async () => {
    const held: FakeChild[] = []
    onDownload = (c) => held.push(c)
    const d = make()
    const items = ['1', '2', '3'].map((id) => d.enqueue(scTrack(id)))
    await d.start()
    await until(() => held.length === 2)
    await tick(30)
    expect(held).toHaveLength(2)
    // Both start together; which spawns first depends on async timing, so compare as a set.
    expect(held.map((c) => c.args.at(-1)).sort()).toEqual([
      'https://api.soundcloud.com/tracks/1',
      'https://api.soundcloud.com/tracks/2'
    ])
    expect(row(items[2]!.id).status).toBe('queued')
    succeed(held[0]!)
    await until(() => held.length === 3)
    expect(held[2]!.args.at(-1)).toBe('https://api.soundcloud.com/tracks/3')
    succeed(held[1]!)
    succeed(held[2]!)
    await d.idle()
    expect(items.map((i) => row(i.id).status)).toEqual(['done', 'done', 'done'])
  })

  it('falls back to yt-dlp, adds the file to the library linked to SoundCloud', async () => {
    official = async () => {
      throw new Error('Log in to SoundCloud')
    }
    const d = make()
    const it = d.enqueue(scTrack('77'))
    await d.start()
    await until(() => row(it.id).status === 'done')
    const done = d.list().find((x) => x.id === it.id)!
    expect(done.method).toBe('ytdlp')
    expect(done.progress).toBe(1)
    expect(done.filePath).toMatch(/\[77\]\.m4a$/)
    const local = db.prepare('SELECT * FROM tracks WHERE id = ?').get(done.localTrackId) as Record<
      string,
      unknown
    >
    expect(local.source_sc_id).toBe('77')
    expect(local.local_path).toBe(done.filePath)
    // Tags were empty: title and artist come from SoundCloud.
    expect(local.title).toBe('Title 77')
    expect(JSON.parse(local.artists as string)).toEqual(['Artist'])
    expect(libraryChanged).toBe(1)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((p) => p.progress <= 0.99)).toBe(true)
  })

  it('uses the official download when there is one', async () => {
    official = async () => ({ url: 'https://cdn.example/x/Original.wav', filename: 'Original.wav' })
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-length': '4', 'content-type': 'audio/wav' }
        })
    )
    const d = make({ fetch: fetchFn })
    const it = d.enqueue(scTrack('5'))
    await d.start()
    await until(() => row(it.id).status === 'done')
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(downloads).toHaveLength(0)
    const r = row(it.id)
    expect(r.method).toBe('official')
    expect(r.file_path).toBe(join(folder, 'Artist - Title 5 [5].wav'))
    expect(existsSync(r.file_path as string)).toBe(true)
    expect(existsSync(`${r.file_path as string}.part`)).toBe(false)
  })

  it('falls back to yt-dlp when the official file fails to download', async () => {
    official = async () => ({ url: 'https://cdn.example/x.mp3' })
    const d = make({ fetch: async () => new Response('nope', { status: 403 }) })
    const it = d.enqueue(scTrack('6'))
    await d.start()
    await until(() => row(it.id).status === 'done')
    expect(row(it.id).method).toBe('ytdlp')
    expect(downloads).toHaveLength(1)
  })

  it('maps DRM failures to a readable error', async () => {
    onDownload = (c) => c.finish(1, 'ERROR: [soundcloud] 9: This video is DRM protected\n')
    const d = make()
    const it = d.enqueue(scTrack('9'))
    await d.start()
    await until(() => row(it.id).status === 'failed')
    expect(row(it.id).error).toBe(DRM_ERROR)
  })

  it('rejects 30-second previews and deletes the file', async () => {
    fileDurationMs = 30_000
    const d = make()
    const it = d.enqueue(scTrack('8', 180_000))
    await d.start()
    await until(() => row(it.id).status === 'failed')
    expect(row(it.id).error).toBe(PREVIEW_ERROR)
    expect(existsSync(join(folder, 'Artist - Title 8 [8].m4a'))).toBe(false)
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE provider = 'local'`).pluck().get()).toBe(0)
  })

  it('cancels a running download: kills yt-dlp, deletes partials, ends Cancelled', async () => {
    onDownload = (c) => {
      const out = c.args[c.args.indexOf('-P') + 1]!
      writeFileSync(join(out, 'Artist - Title 3 [3].m4a.part'), 'partial')
      c.line('CP 10 100 NA')
    }
    const d = make()
    const it = d.enqueue(scTrack('3'))
    await d.start()
    await until(
      () => downloads.length === 1 && existsSync(join(folder, 'Artist - Title 3 [3].m4a.part'))
    )
    await d.cancel(it.id)
    expect(downloads[0]!.killed).toBe(true)
    expect(row(it.id).status).toBe('failed')
    expect(row(it.id).error).toBe(CANCELLED)
    expect(existsSync(join(folder, 'Artist - Title 3 [3].m4a.part'))).toBe(false)
  })

  it('cancels a queued download and retries a failed one', async () => {
    const d = make()
    const it = d.enqueue(scTrack('4'))
    await d.cancel(it.id)
    expect(row(it.id).status).toBe('failed')
    expect(row(it.id).error).toBe(CANCELLED)
    const retried = d.retry(it.id)
    expect(retried.id).toBe(it.id)
    expect(retried.status).toBe('queued')
    expect(retried.error).toBeUndefined()
    await d.start()
    await until(() => row(it.id).status === 'done')
    await d.idle()
    expect(() => d.retry(it.id)).toThrow(/Only failed/)
  })

  it('retry returns the active row when the track was queued again', () => {
    const d = make()
    const it = d.enqueue(scTrack('7'))
    void d.cancel(it.id)
    const again = d.enqueue(scTrack('7'))
    expect(again.id).not.toBe(it.id)
    expect(d.retry(it.id).id).toBe(again.id)
    expect(row(it.id).status).toBe('failed')
  })

  it('resumes rows left running or queued by a previous session', async () => {
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title, artists, duration_ms)
       VALUES ('soundcloud:20', 'soundcloud', '20', 'Old', '["A"]', 200000)`
    ).run()
    const id = Number(
      db
        .prepare(
          `INSERT INTO downloads (sc_track_id, status, progress, method) VALUES ('20', 'running', 0.4, 'ytdlp')`
        )
        .run().lastInsertRowid
    )
    const d = make()
    await d.start()
    await until(() => row(id).status === 'done')
    expect(d.list()[0]!.track.title).toBe('Old')
  })

  it('removes library rows for downloaded files that are gone at startup', async () => {
    const path = join(folder, 'gone [30].m4a')
    const nativeId = nativeIdForPath(path)
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title, local_path, source_sc_id)
       VALUES (?, 'local', ?, 'gone', ?, '30')`
    ).run(`local:${nativeId}`, nativeId, path)
    db.prepare(
      `INSERT INTO downloads (sc_track_id, status, progress, file_path, track_id)
       VALUES ('30', 'done', 1, ?, ?)`
    ).run(path, `local:${nativeId}`)
    const d = make()
    await d.start()
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE provider = 'local'`).pluck().get()).toBe(0)
    expect(d.list()).toHaveLength(1)
    expect(libraryChanged).toBe(1)
  })

  it('passes the login as a temporary cookies file, never as an argument', async () => {
    token = TOKEN
    let seenCookie = ''
    let cookiePath = ''
    onDownload = (c) => {
      cookiePath = c.args[c.args.indexOf('--cookies') + 1]!
      seenCookie = readFileSync(cookiePath, 'utf8')
      succeed(c)
    }
    const d = make()
    const it = d.enqueue(scTrack('40'))
    await d.start()
    await until(() => row(it.id).status === 'done')
    expect(cookiePath.startsWith(join(userData, 'tmp'))).toBe(true)
    expect(seenCookie).toContain(`oauth_token\t${TOKEN}`)
    expect(existsSync(cookiePath)).toBe(false)
    expect(downloads[0]!.args.join(' ')).not.toContain(TOKEN)
  })

  it('deletes the cookies file and redacts the token when yt-dlp fails', async () => {
    token = TOKEN
    let cookiePath = ''
    onDownload = (c) => {
      cookiePath = c.args[c.args.indexOf('--cookies') + 1]!
      c.finish(1, `ERROR: [soundcloud] 41: bad cookie ${TOKEN}\n`)
    }
    const d = make()
    const it = d.enqueue(scTrack('41'))
    await d.start()
    await until(() => row(it.id).status === 'failed')
    expect(existsSync(cookiePath)).toBe(false)
    expect(String(row(it.id).error)).not.toContain(TOKEN)
  })

  it('puts running downloads back in the queue on dispose', async () => {
    onDownload = () => undefined
    const d = make()
    const it = d.enqueue(scTrack('50'))
    await d.start()
    await until(() => downloads.length === 1)
    await d.dispose()
    expect(downloads[0]!.killed).toBe(true)
    expect(row(it.id).status).toBe('queued')
    expect(() => d.enqueue(scTrack('51'))).toThrow(/shutting down/)
  })

  it('stores the folder, clears history and reveals finished files', async () => {
    const revealFile = vi.fn()
    const d = make({ revealFile })
    const other = join(dir, 'Elsewhere')
    const status = await d.setFolder(other)
    expect(status.folder).toBe(other)
    expect(existsSync(other)).toBe(true)
    const it = d.enqueue(scTrack('60'))
    await d.start()
    await until(() => row(it.id).status === 'done')
    expect(String(row(it.id).file_path).startsWith(other)).toBe(true)
    d.reveal(it.id)
    expect(revealFile).toHaveBeenCalledWith(row(it.id).file_path)
    const file = row(it.id).file_path as string
    d.clearHistory()
    expect(d.list()).toHaveLength(0)
    expect(existsSync(file)).toBe(true)
  })
})
