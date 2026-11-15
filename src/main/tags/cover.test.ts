import { describe, expect, it } from 'vitest'
import { COVER_MAX_BYTES, COVER_TOO_BIG_MESSAGE } from '../playlists/cover'
import {
  COVER_EXPIRED_MESSAGE,
  COVER_TOKEN_TTL_MS,
  CoverTokens,
  MAX_COVER_TOKENS,
  PREVIEW_MAX_BYTES,
  TAG_COVER_NOT_IMAGE_MESSAGE,
  pickCover,
  readCoverImage,
  verifyCoverImage
} from './cover'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const bytes = (sig: number[], length = 32): Uint8Array => {
  const b = new Uint8Array(length)
  b.set(sig)
  return b
}
const reader = (data: Uint8Array) => async (): Promise<Uint8Array> => data

function counter(): () => string {
  let n = 0
  return () => `t${n++}`
}

describe('CoverTokens', () => {
  it('resolves a token to the picked image', () => {
    const tokens = new CoverTokens(() => 0, counter())
    const token = tokens.add({ path: 'C:/a.png', format: 'png' })
    expect(tokens.resolve(token)).toEqual({ path: 'C:/a.png', format: 'png' })
  })

  it('refuses unknown tokens', () => {
    expect(() => new CoverTokens().resolve('nope')).toThrow(COVER_EXPIRED_MESSAGE)
  })

  it('expires tokens after 30 minutes', () => {
    let now = 1000
    const tokens = new CoverTokens(() => now, counter())
    const token = tokens.add({ path: 'a.jpg', format: 'jpg' })
    now += COVER_TOKEN_TTL_MS - 1
    expect(tokens.resolve(token).path).toBe('a.jpg')
    now += 1
    expect(() => tokens.resolve(token)).toThrow(COVER_EXPIRED_MESSAGE)
    expect(tokens.size).toBe(0)
  })

  it('keeps at most 20 tokens, dropping the oldest', () => {
    const tokens = new CoverTokens(() => 0, counter())
    const all = Array.from({ length: MAX_COVER_TOKENS + 3 }, (_, i) =>
      tokens.add({ path: `${i}.png`, format: 'png' })
    )
    expect(tokens.size).toBe(MAX_COVER_TOKENS)
    for (const t of all.slice(0, 3)) expect(() => tokens.resolve(t)).toThrow()
    expect(tokens.resolve(all.at(-1)!).path).toBe(`${MAX_COVER_TOKENS + 2}.png`)
    expect(tokens.resolve(all[3]!).path).toBe('3.png')
  })

  it('drops expired tokens when adding', () => {
    let now = 0
    const tokens = new CoverTokens(() => now, counter())
    tokens.add({ path: 'a.png', format: 'png' })
    now = COVER_TOKEN_TTL_MS
    tokens.add({ path: 'b.png', format: 'png' })
    expect(tokens.size).toBe(1)
  })

  it('uses unguessable tokens by default', () => {
    const tokens = new CoverTokens()
    const a = tokens.add({ path: 'a.png', format: 'png' })
    const b = tokens.add({ path: 'a.png', format: 'png' })
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('readCoverImage', () => {
  it('accepts JPEG and PNG by signature', async () => {
    expect((await readCoverImage('x.png', reader(bytes(JPEG)))).format).toBe('jpg')
    expect((await readCoverImage('x.jpg', reader(bytes(PNG)))).format).toBe('png')
  })

  it('refuses WebP, GIF and non-images', async () => {
    const webp = new Uint8Array([...'RIFF\0\0\0\0WEBP'].map((c) => c.charCodeAt(0)))
    const gif = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)))
    for (const b of [webp, gif, new Uint8Array([1, 2, 3])])
      await expect(readCoverImage('x', reader(b))).rejects.toThrow(TAG_COVER_NOT_IMAGE_MESSAGE)
  })

  it('refuses files over 10 MB', async () => {
    await expect(readCoverImage('x', reader(bytes(PNG, COVER_MAX_BYTES + 1)))).rejects.toThrow(
      COVER_TOO_BIG_MESSAGE
    )
  })

  it('reports read errors', async () => {
    const fail = async (): Promise<Uint8Array> => {
      throw new Error('ENOENT')
    }
    await expect(readCoverImage('x', fail)).rejects.toThrow("Couldn't read that image: ENOENT")
  })

  it('verifyCoverImage notices a swapped file', async () => {
    await expect(
      verifyCoverImage({ path: 'x', format: 'png' }, reader(bytes(PNG)))
    ).resolves.toBeUndefined()
    await expect(
      verifyCoverImage({ path: 'x', format: 'png' }, reader(bytes(JPEG)))
    ).rejects.toThrow(/changed/)
  })
})

describe('pickCover', () => {
  it('returns null when cancelled', async () => {
    const tokens = new CoverTokens()
    expect(await pickCover({ pick: async () => null, tokens })).toBeNull()
    expect(tokens.size).toBe(0)
  })

  it('stores the path under a token and returns a data URL preview', async () => {
    const tokens = new CoverTokens(() => 0, counter())
    const data = bytes(PNG)
    const res = await pickCover({
      pick: async () => 'C:\\pics\\front.png',
      tokens,
      read: reader(data)
    })
    expect(res).toEqual({
      token: 't0',
      previewUrl: `data:image/png;base64,${Buffer.from(data).toString('base64')}`,
      name: 'front.png'
    })
    expect(tokens.resolve('t0')).toEqual({ path: 'C:\\pics\\front.png', format: 'png' })
  })

  it('skips the preview for images over 300 KB', async () => {
    const tokens = new CoverTokens()
    const res = await pickCover({
      pick: async () => 'big.jpg',
      tokens,
      read: reader(bytes(JPEG, PREVIEW_MAX_BYTES + 1))
    })
    expect(res?.previewUrl).toBe('')
    expect(res?.name).toBe('big.jpg')
  })

  it('stores nothing for a bad image', async () => {
    const tokens = new CoverTokens()
    await expect(
      pickCover({ pick: async () => 'a.gif', tokens, read: reader(new Uint8Array([0])) })
    ).rejects.toThrow(TAG_COVER_NOT_IMAGE_MESSAGE)
    expect(tokens.size).toBe(0)
  })
})
