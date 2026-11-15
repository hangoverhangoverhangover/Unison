import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COVER_MAX_BYTES,
  COVER_NOT_IMAGE_MESSAGE,
  COVER_TOO_BIG_MESSAGE,
  importCover,
  readLimited,
  sniffImage
} from './cover'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const GIF = Buffer.from('GIF89a....', 'latin1')
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 ', 'latin1')
])

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cover-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('sniffImage', () => {
  it('detects JPEG, PNG, GIF and WebP from the bytes', () => {
    expect(sniffImage(JPEG)).toBe('jpg')
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(GIF)).toBe('gif')
    expect(sniffImage(Buffer.from('GIF87a', 'latin1'))).toBe('gif')
    expect(sniffImage(WEBP)).toBe('webp')
  })

  it('rejects everything else', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(sniffImage(Buffer.from('RIFF....WAVE', 'latin1'))).toBeNull()
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(Buffer.from('BM......'))).toBeNull()
  })
})

describe('importCover', () => {
  const artworkDir = (): string => join(dir, 'artwork')

  it('copies the bytes to <sha1>.<sniffed ext>, ignoring the file extension', async () => {
    const src = join(dir, 'cover.jpg') // really a PNG
    writeFileSync(src, PNG)
    const hash = await importCover(src, { artworkDir: artworkDir() })
    expect(hash).toBe(createHash('sha1').update(PNG).digest('hex'))
    expect(readdirSync(artworkDir())).toEqual([`${hash}.png`])
    expect(readFileSync(join(artworkDir(), `${hash}.png`))).toEqual(PNG)
    // Same image again: same file, no temp files left behind.
    expect(await importCover(src, { artworkDir: artworkDir() })).toBe(hash)
    expect(readdirSync(artworkDir())).toEqual([`${hash}.png`])
  })

  it('rejects a file that is not an image, whatever its name', async () => {
    const src = join(dir, 'evil.png')
    writeFileSync(src, 'MZ not an image')
    await expect(importCover(src, { artworkDir: artworkDir() })).rejects.toThrow(
      COVER_NOT_IMAGE_MESSAGE
    )
    expect(existsSync(artworkDir())).toBe(false)
  })

  it('rejects files over 10 MB', async () => {
    const src = join(dir, 'big.jpg')
    writeFileSync(src, Buffer.concat([JPEG, Buffer.alloc(COVER_MAX_BYTES)]))
    await expect(importCover(src, { artworkDir: artworkDir() })).rejects.toThrow(
      COVER_TOO_BIG_MESSAGE
    )
    expect(existsSync(artworkDir())).toBe(false)
  })

  it('accepts exactly 10 MB', async () => {
    const write = vi.fn(async () => 'h')
    const exact = Buffer.concat([JPEG, Buffer.alloc(COVER_MAX_BYTES - JPEG.length)])
    const read = vi.fn(async () => exact)
    await expect(importCover('x', { artworkDir: 'd', read, write })).resolves.toBe('h')
    expect(write).toHaveBeenCalledWith(exact, 'jpg', 'd')
    expect(read).toHaveBeenCalledWith('x', COVER_MAX_BYTES)
  })

  it('reports unreadable files readably', async () => {
    await expect(
      importCover(join(dir, 'missing.png'), { artworkDir: artworkDir() })
    ).rejects.toThrow(/Couldn't read that image/)
  })
})

describe('readLimited', () => {
  it('reads small files whole and stops at max + 1 for big ones', async () => {
    const small = join(dir, 's')
    writeFileSync(small, GIF)
    expect(Buffer.from(await readLimited(small, 100))).toEqual(GIF)
    const big = join(dir, 'b')
    writeFileSync(big, Buffer.alloc(50))
    expect((await readLimited(big, 10)).length).toBe(11)
  })

  it('refuses a directory', async () => {
    await expect(readLimited(dir, 10)).rejects.toThrow()
  })
})
