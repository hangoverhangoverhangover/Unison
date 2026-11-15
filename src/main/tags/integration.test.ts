// Real ffmpeg round trip on files generated into a temp dir. Skipped without bin/ffmpeg.exe.
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseFile } from 'music-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { defaultSpawn, runProcess } from '../downloads/process'
import { FFMPEG_EXE } from '../downloads/tools'
import { nativeIdForPath } from '../library/paths'
import { updateFile } from '../library/scanner'
import { normalizeEdit } from './args'
import type { CoverImage } from './cover'
import { writeTags } from './writer'

const ffmpeg = join(process.cwd(), 'bin', FFMPEG_EXE)
const hasFfmpeg = existsSync(ffmpeg)

let dir: string

async function ff(args: string[]): Promise<void> {
  const r = await runProcess(defaultSpawn, ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...args
  ]).done
  if (r.code !== 0) throw new Error(r.stderr)
}

/** One second of silence with old tags and a cover picture. */
async function makeFile(name: string, withCover: boolean): Promise<string> {
  const plain = join(dir, `plain-${name}`)
  await ff([
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    '1',
    ...['-metadata', 'title=Old', '-metadata', 'artist=Old Artist', '-metadata', 'album=Old Album'],
    plain
  ])
  if (!withCover) return plain
  const out = join(dir, name)
  const extra = name.endsWith('.mp3') ? ['-id3v2_version', '3'] : []
  await ff([
    '-i',
    plain,
    '-i',
    join(dir, 'cover.png'),
    '-map',
    '0',
    '-map',
    '1',
    '-c',
    'copy',
    '-disposition:v',
    'attached_pic',
    ...extra,
    out
  ])
  return out
}

describe.skipIf(!hasFfmpeg)('writing tags with the real ffmpeg', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tags-ff-'))
    await ff(['-f', 'lavfi', '-i', 'color=red:s=32x32', '-frames:v', '1', join(dir, 'cover.png')])
    await ff(['-f', 'lavfi', '-i', 'color=blue:s=48x48', '-frames:v', '1', join(dir, 'new.png')])
    await ff(['-f', 'lavfi', '-i', 'color=green:s=40x40', '-frames:v', '1', join(dir, 'new.jpg')])
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const deps = { ffmpegPath: ffmpeg, spawn: defaultSpawn }
  const title = 'New ★ title \u{1F3B5}'

  for (const name of ['song.mp3', 'song.m4a']) {
    it(`${name}: writes every field, clears album, keeps the cover`, async () => {
      const path = await makeFile(name, true)
      const edit = normalizeEdit({
        title,
        artist: 'Ärtist',
        album: '',
        albumArtist: 'Various',
        trackNo: 7,
        year: '2021',
        genre: 'Plugg'
      })
      await writeTags(path, edit, deps)
      const { common } = await parseFile(path)
      expect(common.title).toBe(title)
      expect(common.artist).toBe('Ärtist')
      expect(common.album).toBeUndefined()
      expect(common.albumartist).toBe('Various')
      expect(common.track.no).toBe(7)
      expect(common.year).toBe(2021)
      expect(common.genre).toEqual(['Plugg'])
      expect(common.picture?.length).toBe(1)

      // Clearing the track number; untouched fields stay.
      await writeTags(path, normalizeEdit({ trackNo: null }), deps)
      const again = (await parseFile(path)).common
      expect(again.track.no).toBeNull()
      expect(again.title).toBe(title)
      expect(again.picture?.length).toBe(1)
    })
  }

  it('opus: replaces the stream-level tags', async () => {
    const path = await makeFile('song.opus', false)
    await writeTags(path, normalizeEdit({ title, artist: 'A' }), deps)
    const { common } = await parseFile(path)
    expect(common.title).toBe(title)
    expect(common.artist).toBe('A')
    expect(common.album).toBe('Old Album')
  })

  const sha1 = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex')

  for (const name of ['cover.mp3', 'cover.m4a', 'cover.flac']) {
    it(`${name}: sets, replaces and removes the cover; tags and library art follow`, async () => {
      const path = await makeFile(name, true)
      const png: CoverImage = { path: join(dir, 'new.png'), format: 'png' }
      const jpg: CoverImage = { path: join(dir, 'new.jpg'), format: 'jpg' }
      const pngBytes = readFileSync(png.path)
      const jpgBytes = readFileSync(jpg.path)
      const db = openDb(':memory:')
      const artDir = join(dir, `art-${name}`)
      const row = (): { artwork_url: string | null; art_hash: string | null } =>
        db
          .prepare(`SELECT artwork_url, art_hash FROM tracks WHERE native_id = ?`)
          .get(nativeIdForPath(path)) as { artwork_url: string | null; art_hash: string | null }
      try {
        // Set (replacing the red cover from makeFile) together with a text edit.
        await writeTags(path, { cover: png, title: 'With cover' }, deps)
        let common = (await parseFile(path)).common
        expect(common.title).toBe('With cover')
        expect(common.artist).toBe('Old Artist')
        expect(common.album).toBe('Old Album')
        expect(common.picture).toHaveLength(1)
        expect(common.picture![0]!.format).toBe('image/png')
        expect(Buffer.from(common.picture![0]!.data).equals(pngBytes)).toBe(true)
        expect(await updateFile(db, path, artDir)).toBe(true)
        expect(row().art_hash).toBe(sha1(pngBytes))
        expect(row().artwork_url).toContain(sha1(pngBytes))

        // Replace with a JPEG.
        await writeTags(path, { cover: jpg }, deps)
        common = (await parseFile(path)).common
        expect(common.picture).toHaveLength(1)
        expect(common.picture![0]!.format).toBe('image/jpeg')
        expect(Buffer.from(common.picture![0]!.data).equals(jpgBytes)).toBe(true)
        expect(common.title).toBe('With cover')
        await updateFile(db, path, artDir)
        expect(row().art_hash).toBe(sha1(jpgBytes))

        // A text-only edit keeps it.
        await writeTags(path, normalizeEdit({ genre: 'G' }), deps)
        expect((await parseFile(path)).common.picture).toHaveLength(1)

        // Remove.
        await writeTags(path, normalizeEdit({ cover: null }), deps)
        common = (await parseFile(path)).common
        expect(common.picture ?? []).toHaveLength(0)
        expect(common.title).toBe('With cover')
        expect(common.artist).toBe('Old Artist')
        expect(common.genre).toEqual(['G'])
        const { format } = await parseFile(path)
        expect(format.duration).toBeGreaterThan(0.9)
        await updateFile(db, path, artDir)
        expect(row()).toEqual({ artwork_url: null, art_hash: null })

        // Removing again (no cover) still works.
        await writeTags(path, normalizeEdit({ cover: null }), deps)
        expect((await parseFile(path)).common.picture ?? []).toHaveLength(0)
      } finally {
        db.close()
      }
    })
  }

  it('leaves no temp files behind', () => {
    expect(readdirSync(dir).filter((f) => /\.(tagtmp|tagbak)$/.test(f))).toEqual([])
  })
})
