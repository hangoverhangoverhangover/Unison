import { describe, expect, it } from 'vitest'
import {
  buildFfmpegArgs,
  checkEditForFile,
  COVER_UNSUPPORTED_MESSAGE,
  normalizeEdit,
  type NormalizedEdit
} from './args'
import type { CoverImage } from './cover'

function metadataOf(args: string[], flag = '-metadata'): string[] {
  const out: string[] = []
  args.forEach((a, i) => {
    if (a === flag) out.push(args[i + 1]!)
  })
  return out
}

describe('normalizeEdit', () => {
  it('trims text, keeps empty strings as "clear"', () => {
    expect(normalizeEdit({ title: '  Hi  ', artist: '' })).toEqual({ title: 'Hi', artist: '' })
  })

  it('replaces control characters', () => {
    expect(normalizeEdit({ title: 'a\nb\u0000c' })).toEqual({ title: 'a b c' })
  })

  it('accepts trackNo null (clear) and whole numbers', () => {
    expect(normalizeEdit({ trackNo: null })).toEqual({ trackNo: null })
    expect(normalizeEdit({ trackNo: 3 })).toEqual({ trackNo: 3 })
  })

  it('rejects bad values', () => {
    expect(() => normalizeEdit(null)).toThrow()
    expect(() => normalizeEdit([])).toThrow()
    expect(() => normalizeEdit({})).toThrow('Nothing to change')
    expect(() => normalizeEdit({ bogus: 'x' })).toThrow('Unknown tag field')
    expect(() => normalizeEdit({ title: 5 })).toThrow('must be text')
    expect(() => normalizeEdit({ title: 'x'.repeat(501) })).toThrow('too long')
    expect(() => normalizeEdit({ trackNo: 0 })).toThrow('track number')
    expect(() => normalizeEdit({ trackNo: 1.5 })).toThrow('track number')
    expect(() => normalizeEdit({ trackNo: '3' })).toThrow('track number')
    expect(() => normalizeEdit({ year: 'last year' })).toThrow('year')
  })

  it('accepts a year or a full date', () => {
    expect(normalizeEdit({ year: '2024' })).toEqual({ year: '2024' })
    expect(normalizeEdit({ year: '2024-05-31' })).toEqual({ year: '2024-05-31' })
    expect(normalizeEdit({ year: '' })).toEqual({ year: '' })
  })

  it('accepts exactly 500 characters', () => {
    expect(normalizeEdit({ title: 'x'.repeat(500) }).title).toHaveLength(500)
  })
})

describe('buildFfmpegArgs', () => {
  const all = normalizeEdit({
    title: 'T \u2605',
    artist: 'A',
    album: 'Al',
    albumArtist: 'AA',
    trackNo: 4,
    year: '2020',
    genre: 'G'
  })

  it('copies every stream and existing metadata for mp3, with ID3v2.3', () => {
    const args = buildFfmpegArgs('C:\\m\\a.mp3', 'C:\\m\\a.mp3.x.tagtmp', all)
    expect(args.slice(0, 7)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'C:\\m\\a.mp3'
    ])
    expect(args).toContain('-map')
    expect(args[args.indexOf('-map') + 1]).toBe('0')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('0')
    expect(metadataOf(args)).toEqual([
      'title=T \u2605',
      'artist=A',
      'album=Al',
      'album_artist=AA',
      'track=4',
      'date=2020',
      'genre=G'
    ])
    expect(args[args.indexOf('-id3v2_version') + 1]).toBe('3')
    expect(args.slice(-3)).toEqual(['-f', 'mp3', 'C:\\m\\a.mp3.x.tagtmp'])
  })

  it('only writes the fields in the edit; empty and null clear', () => {
    const args = buildFfmpegArgs('a.flac', 'o', normalizeEdit({ album: '', trackNo: null }))
    expect(metadataOf(args)).toEqual(['album=', 'track='])
    expect(args.slice(-3)).toEqual(['-f', 'flac', 'o'])
  })

  it('picks the muxer from the extension, case-insensitively', () => {
    const muxer = (p: string): string => {
      const a = buildFfmpegArgs(p, 'o', normalizeEdit({ title: 'x' }))
      return a[a.indexOf('-f') + 1]!
    }
    expect(muxer('a.M4A')).toBe('ipod')
    expect(muxer('a.mp4')).toBe('mp4')
    expect(muxer('a.aac')).toBe('adts')
    expect(muxer('a.ogg')).toBe('ogg')
    expect(muxer('a.opus')).toBe('opus')
    expect(muxer('a.wav')).toBe('wav')
  })

  it('writes ID3v2 into raw AAC', () => {
    const args = buildFfmpegArgs('a.aac', 'o', normalizeEdit({ title: 'x' }))
    expect(args[args.indexOf('-write_id3v2') + 1]).toBe('1')
  })

  it('also writes stream tags for Ogg and Opus (where the old tags live)', () => {
    const args = buildFfmpegArgs('a.opus', 'o', normalizeEdit({ title: 'x', artist: '' }))
    expect(metadataOf(args)).toEqual(['title=x', 'artist='])
    expect(metadataOf(args, '-metadata:s:a')).toEqual(['title=x', 'artist='])
    const mp3 = buildFfmpegArgs('a.mp3', 'o', normalizeEdit({ title: 'x' }))
    expect(metadataOf(mp3, '-metadata:s:a')).toEqual([])
  })

  it('refuses unknown extensions', () => {
    expect(() => buildFfmpegArgs('a.wma', 'o', normalizeEdit({ title: 'x' }))).toThrow()
  })
})

describe('checkEditForFile', () => {
  it('allows everything for mp3', () => {
    expect(checkEditForFile('a.mp3', normalizeEdit({ albumArtist: 'x', title: '\u2605' }))).toBe(
      undefined
    )
  })

  it("reports fields WAV can't store instead of dropping them", () => {
    expect(checkEditForFile('a.wav', normalizeEdit({ albumArtist: 'x' }))).toMatch(/album artist/)
    expect(checkEditForFile('a.wav', normalizeEdit({ albumArtist: '' }))).toBe(undefined)
    expect(checkEditForFile('a.wav', normalizeEdit({ title: 'T \u2605' }))).toMatch(/ASCII/)
    expect(checkEditForFile('a.wav', normalizeEdit({ title: 'Plain', trackNo: 2 }))).toBe(undefined)
  })

  it('reports unsupported file types', () => {
    expect(checkEditForFile('a.wma', normalizeEdit({ title: 'x' }))).toMatch(/\.wma/)
  })
})

describe('cover edits', () => {
  const png: CoverImage = { path: 'C:\\p\\c.png', format: 'png' }
  const jpg: CoverImage = { path: 'C:\\p\\c.jpg', format: 'jpg' }
  const resolve = (token: string): CoverImage => {
    if (token === 'png') return png
    if (token === 'jpg') return jpg
    throw new Error('expired')
  }
  const after = (args: string[], flag: string): string[] =>
    args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []))

  it('normalizeEdit resolves tokens, keeps null, rejects bad values', () => {
    expect(normalizeEdit({ cover: 'png' }, resolve)).toEqual({ cover: png })
    expect(normalizeEdit({ cover: null })).toEqual({ cover: null })
    expect(normalizeEdit({ cover: 'jpg', title: 'x' }, resolve)).toEqual({ cover: jpg, title: 'x' })
    expect(() => normalizeEdit({ cover: 'gone' }, resolve)).toThrow('expired')
    expect(() => normalizeEdit({ cover: 'png' })).toThrow(/can't be set/)
    expect(() => normalizeEdit({ cover: 5 }, resolve)).toThrow('Invalid cover')
    expect(() => normalizeEdit({ cover: '' }, resolve)).toThrow('Invalid cover')
  })

  it('unchanged cover copies every stream', () => {
    const args = buildFfmpegArgs('a.mp3', 'o', normalizeEdit({ title: 'x' }))
    expect(after(args, '-map')).toEqual(['0'])
    expect(after(args, '-i')).toEqual(['a.mp3'])
    expect(args).not.toContain('-disposition:v:0')
  })

  it('mp3: adds the image as an attached picture with ID3 cover labels', () => {
    const edit: NormalizedEdit = { cover: png, title: 'T' }
    const args = buildFfmpegArgs('a.mp3', 'o', edit)
    expect(after(args, '-i')).toEqual(['a.mp3', png.path])
    expect(args[args.indexOf(png.path) - 2]).toBe('png_pipe')
    expect(after(args, '-map')).toEqual(['0:a', '1'])
    expect(after(args, '-c')).toEqual(['copy'])
    expect(after(args, '-map_metadata')).toEqual(['0'])
    expect(after(args, '-disposition:v:0')).toEqual(['attached_pic'])
    expect(after(args, '-metadata:s:v')).toEqual(['title=Album cover', 'comment=Cover (front)'])
    expect(after(args, '-metadata')).toEqual(['title=T'])
    expect(after(args, '-id3v2_version')).toEqual(['3'])
    expect(args.slice(-3)).toEqual(['-f', 'mp3', 'o'])
  })

  it('flac, m4a and mp4: picks the demuxer from the sniffed format', () => {
    const flac = buildFfmpegArgs('a.flac', 'o', { cover: jpg })
    expect(flac[flac.indexOf(jpg.path) - 2]).toBe('jpeg_pipe')
    expect(after(flac, '-metadata:s:v')).toEqual(['comment=Cover (front)'])
    for (const [file, muxer] of [
      ['a.m4a', 'ipod'],
      ['a.MP4', 'mp4']
    ] as const) {
      const args = buildFfmpegArgs(file, 'o', { cover: png })
      expect(after(args, '-map')).toEqual(['0:a', '1'])
      expect(after(args, '-disposition:v:0')).toEqual(['attached_pic'])
      expect(after(args, '-metadata:s:v')).toEqual([])
      expect(args.slice(-3)).toEqual(['-f', muxer, 'o'])
    }
  })

  it('remove: keeps only the audio (and the metadata)', () => {
    for (const file of ['a.mp3', 'a.m4a', 'a.mp4', 'a.flac']) {
      const args = buildFfmpegArgs(file, 'o', normalizeEdit({ cover: null, album: 'A' }))
      expect(after(args, '-i')).toEqual([file])
      expect(after(args, '-map')).toEqual(['0:a'])
      expect(after(args, '-map_metadata')).toEqual(['0'])
      expect(after(args, '-metadata')).toEqual(['album=A'])
      expect(args).not.toContain('-disposition:v:0')
    }
  })

  it('refuses cover changes for formats that cannot hold art', () => {
    for (const file of ['a.ogg', 'a.opus', 'a.wav', 'a.aac']) {
      expect(checkEditForFile(file, { cover: png, title: 'x' })).toBe(COVER_UNSUPPORTED_MESSAGE)
      expect(checkEditForFile(file, { cover: null })).toBe(COVER_UNSUPPORTED_MESSAGE)
      expect(checkEditForFile(file, { title: 'x' })).toBe(undefined)
      expect(() => buildFfmpegArgs(file, 'o', { cover: null })).toThrow(COVER_UNSUPPORTED_MESSAGE)
    }
    expect(checkEditForFile('a.FLAC', { cover: png })).toBe(undefined)
  })
})
