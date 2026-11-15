import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../db'
import { nativeIdForPath } from '../library/paths'
import { setFolders, upsertTracks } from '../library/store'
import type { NormalizedEdit } from './args'
import { createTagService, type TagService, type WriteFn } from './service'

let dir: string
let music: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tags-'))
  music = join(dir, 'music')
  mkdirSync(music, { recursive: true })
  db = openDb(':memory:')
  setFolders(db, [music])
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Create a (fake) audio file and its library row; returns the track id. */
function addTrack(path: string, create = true): string {
  if (create) writeFileSync(path, 'x')
  const nativeId = nativeIdForPath(path)
  upsertTracks(db, [
    { nativeId, path, title: 't', artists: [], durationMs: 1, mtimeMs: 1, size: 1 }
  ])
  return `local:${nativeId}`
}

function service(write: WriteFn = async () => undefined): {
  svc: TagService
  onLibraryChanged: ReturnType<typeof vi.fn>
  reread: ReturnType<typeof vi.fn>
} {
  const onLibraryChanged = vi.fn()
  const reread = vi.fn(async () => true)
  const svc = createTagService({
    db,
    artworkDir: join(dir, 'art'),
    write,
    reread,
    onLibraryChanged,
    log: () => undefined
  })
  return { svc, onLibraryChanged, reread }
}

describe('tags:edit', () => {
  it('writes each file, re-reads it and reports library:changed once', async () => {
    const a = join(music, 'a.mp3')
    const b = join(music, 'b.flac')
    const ids = [addTrack(a), addTrack(b)]
    const writes: [string, NormalizedEdit][] = []
    const { svc, onLibraryChanged, reread } = service(async (p, e) => void writes.push([p, e]))
    const res = await svc.edit(ids, { album: ' X ', trackNo: null })
    expect(res).toEqual([
      { trackId: ids[0], ok: true },
      { trackId: ids[1], ok: true }
    ])
    expect(writes.map((w) => w[0]).sort()).toEqual([a, b].sort())
    expect(writes[0]![1]).toEqual({ album: 'X', trackNo: null })
    expect(reread).toHaveBeenCalledTimes(2)
    expect(onLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('refuses non-local ids, unknown rows, files outside the folders and missing files', async () => {
    const outside = join(dir, 'outside.mp3')
    const missing = join(music, 'gone.mp3')
    const ids = [
      'spotify:abc',
      'local:',
      'local:deadbeef',
      addTrack(outside),
      addTrack(missing, false)
    ]
    const write = vi.fn(async () => undefined)
    const { svc, onLibraryChanged } = service(write)
    const res = await svc.edit(ids, { title: 'x' })
    expect(res.map((r) => r.ok)).toEqual([false, false, false, false, false])
    expect(res[0]!.error).toMatch(/Only local/)
    expect(res[2]!.error).toMatch(/Not in the local library/)
    expect(res[3]!.error).toMatch(/library folders/)
    expect(res[4]!.error).toMatch(/missing/)
    expect(write).not.toHaveBeenCalled()
    expect(onLibraryChanged).not.toHaveBeenCalled()
  })

  it('reports per-file failures and keeps going', async () => {
    const ids = [addTrack(join(music, 'a.mp3')), addTrack(join(music, 'b.mp3'))]
    const { svc, onLibraryChanged } = service(async (p) => {
      if (p.endsWith('a.mp3')) throw new Error('boom')
    })
    const res = await svc.edit(ids, { title: 'x' })
    expect(res).toEqual([
      { trackId: ids[0], ok: false, error: 'boom' },
      { trackId: ids[1], ok: true }
    ])
    expect(onLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('refuses fields the format cannot hold', async () => {
    const id = addTrack(join(music, 'a.wav'))
    const write = vi.fn(async () => undefined)
    const res = await service(write).svc.edit([id], { albumArtist: 'x' })
    expect(res[0]).toMatchObject({ ok: false, error: expect.stringMatching(/album artist/) })
    expect(write).not.toHaveBeenCalled()
  })

  it('throws on malformed input', async () => {
    const { svc } = service()
    await expect(svc.edit('nope', { title: 'x' })).rejects.toThrow()
    await expect(svc.edit([1], { title: 'x' })).rejects.toThrow()
    await expect(svc.edit([], {})).rejects.toThrow('Nothing to change')
  })

  it('runs at most two writes at a time', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => addTrack(join(music, `${i}.mp3`)))
    let active = 0
    let peak = 0
    const { svc } = service(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    const res = await svc.edit(ids, { genre: 'g' })
    expect(res.every((r) => r.ok)).toBe(true)
    expect(peak).toBe(2)
  })
})

describe('tags:proposeFromFilenames', () => {
  it('parses names and explains skips', () => {
    const ids = [
      addTrack(join(music, 'Artist - Song [123].mp3')),
      addTrack(join(music, 'NoDash.mp3')),
      'spotify:x'
    ]
    const res = service().svc.proposeFromFilenames(ids)
    expect(res[0]).toEqual({
      trackId: ids[0],
      fileName: 'Artist - Song [123]',
      artist: 'Artist',
      title: 'Song'
    })
    expect(res[1]).toEqual({
      trackId: ids[1],
      fileName: 'NoDash',
      skipped: "No ' - ' in the file name"
    })
    expect(res[2]).toMatchObject({ trackId: 'spotify:x', skipped: expect.any(String) })
  })
})

describe('tags:applyProposals', () => {
  it('writes artist and title, ignores skipped ones, re-checks the file name', async () => {
    const a = join(music, 'A - T.mp3')
    const ids = [addTrack(a), addTrack(join(music, 'B - U.mp3')), addTrack(join(music, 'X.mp3'))]
    const writes: [string, NormalizedEdit][] = []
    const { svc, onLibraryChanged } = service(async (p, e) => void writes.push([p, e]))
    const res = await svc.applyProposals([
      { trackId: ids[0], fileName: 'A - T', artist: 'A', title: 'T (edited)' },
      { trackId: ids[1], fileName: 'Old name', artist: 'B', title: 'U' },
      { trackId: ids[2], fileName: 'X', skipped: 'no dash' },
      { trackId: 'soundcloud:1', fileName: 'x', artist: 'a', title: 'b' }
    ])
    expect(res).toEqual([
      { trackId: ids[0], ok: true },
      { trackId: ids[1], ok: false, error: expect.stringMatching(/renamed/) },
      { trackId: 'soundcloud:1', ok: false, error: expect.stringMatching(/Only local/) }
    ])
    expect(writes).toEqual([[a, { artist: 'A', title: 'T (edited)' }]])
    expect(onLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('refuses empty or oversized values', async () => {
    const id = addTrack(join(music, 'A - T.mp3'))
    const { svc } = service()
    const res = await svc.applyProposals([
      { trackId: id, fileName: 'A - T', artist: ' ', title: 'T' }
    ])
    expect(res[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Missing/) })
    const res2 = await svc.applyProposals([
      { trackId: id, fileName: 'A - T', artist: 'a'.repeat(501), title: 'T' }
    ])
    expect(res2[0]).toMatchObject({ ok: false, error: expect.stringMatching(/too long/) })
  })
})

describe('tags:edit cover art', () => {
  const image = { path: join('C:', 'pics', 'c.png'), format: 'png' as const }

  function coverService(checkCover = vi.fn(async () => undefined)): {
    svc: TagService
    writes: [string, NormalizedEdit][]
    checkCover: typeof checkCover
  } {
    const writes: [string, NormalizedEdit][] = []
    const svc = createTagService({
      db,
      artworkDir: join(dir, 'art'),
      write: async (p, e) => void writes.push([p, e]),
      reread: async () => true,
      resolveCover: (token) => {
        if (token !== 'tok') throw new Error('The picked cover image has expired. Pick it again.')
        return image
      },
      checkCover,
      onLibraryChanged: () => undefined,
      log: () => undefined
    })
    return { svc, writes, checkCover }
  }

  it('resolves the token, re-checks the image once, writes supported files', async () => {
    const mp3 = join(music, 'a.mp3')
    const flac = join(music, 'b.flac')
    const ogg = join(music, 'c.ogg')
    const ids = [addTrack(mp3), addTrack(flac), addTrack(ogg)]
    const { svc, writes, checkCover } = coverService()
    const res = await svc.edit(ids, { cover: 'tok', title: 'T' })
    expect(res).toEqual([
      { trackId: ids[0], ok: true },
      { trackId: ids[1], ok: true },
      { trackId: ids[2], ok: false, error: "This file type can't hold cover art." }
    ])
    expect(checkCover).toHaveBeenCalledTimes(1)
    expect(writes.map((w) => w[0]).sort()).toEqual([mp3, flac].sort())
    expect(writes[0]![1]).toEqual({ cover: image, title: 'T' })
  })

  it('removing the cover fails atomically for files that cannot hold art', async () => {
    const ids = [addTrack(join(music, 'a.m4a')), addTrack(join(music, 'b.wav'))]
    const { svc, writes, checkCover } = coverService()
    const res = await svc.edit(ids, { cover: null, album: 'X' })
    expect(res.map((r) => r.ok)).toEqual([true, false])
    expect(writes).toHaveLength(1)
    expect(writes[0]![1]).toEqual({ cover: null, album: 'X' })
    expect(checkCover).not.toHaveBeenCalled()
  })

  it('refuses an unknown token or an image that no longer checks out', async () => {
    const id = addTrack(join(music, 'a.mp3'))
    const { svc, writes } = coverService()
    await expect(svc.edit([id], { cover: 'other' })).rejects.toThrow(/expired/)
    const bad = coverService(
      vi.fn(async () => {
        throw new Error('The picked cover image changed. Pick it again.')
      })
    )
    await expect(bad.svc.edit([id], { cover: 'tok' })).rejects.toThrow(/changed/)
    expect(writes).toEqual([])
    expect(bad.writes).toEqual([])
  })

  it('refuses tokens when no cover store is wired', async () => {
    const id = addTrack(join(music, 'a.mp3'))
    await expect(service().svc.edit([id], { cover: 'tok' })).rejects.toThrow(/can't be set/)
  })
})
