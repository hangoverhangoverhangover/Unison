import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMediaHandler } from './media'

const id = 'a'.repeat(40)
const hash = 'b'.repeat(40)
let dir: string
let handler: (req: Request) => Promise<Response>

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'media-'))
  writeFileSync(join(dir, 'song.mp3'), Buffer.from('0123456789'))
  writeFileSync(join(dir, `${hash}.png`), Buffer.from('png'))
  handler = createMediaHandler({
    lookupLocalPath: (n) => (n === id ? join(dir, 'song.mp3') : undefined),
    artworkDir: dir
  })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const get = (url: string, range?: string): Promise<Response> =>
  handler(new Request(url, range ? { headers: { Range: range } } : {}))

describe('media handler', () => {
  it('serves a whole file with type and range support', async () => {
    const res = await get(`media://local/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe('0123456789')
  })

  it('serves a byte range with 206', async () => {
    const res = await get(`media://local/${id}`, 'bytes=2-4')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await res.text()).toBe('234')
  })

  it('answers 416 for unsatisfiable ranges', async () => {
    const res = await get(`media://local/${id}`, 'bytes=50-')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })

  it('serves cached artwork', async () => {
    const res = await get(`media://art/${hash}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(await res.text()).toBe('png')
  })

  it('404s anything else', async () => {
    for (const url of [
      `media://local/${'c'.repeat(40)}`,
      'media://local/..%2F..%2Fetc',
      'media://art/xyz',
      `media://other/${id}`
    ])
      expect((await get(url)).status).toBe(404)
  })
})
