import { runDurableObjectAlarm } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ART_MAX_BYTES } from '../src/art'

const BASE = 'https://relay.test'
const jpeg = (size = 100): Uint8Array => {
  const b = new Uint8Array(size)
  b.set([0xff, 0xd8, 0xff, 0xe0])
  return b
}
const upload = (body: Uint8Array, ip = '1.2.3.4'): Promise<Response> =>
  exports.default.fetch(`${BASE}/art`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': ip },
    body
  })

describe('cover art (QoL 4)', () => {
  it('stores an upload under a random id, serves it, and deletes it with the secret', async () => {
    const res = await upload(jpeg())
    expect(res.status).toBe(201)
    const { id, secret } = (await res.json()) as { id: string; secret: string }
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    const got = await exports.default.fetch(`${BASE}/art/${id}`)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/jpeg')
    expect((await got.arrayBuffer()).byteLength).toBe(100)
    const wrong = await exports.default.fetch(`${BASE}/art/${id}`, {
      method: 'DELETE',
      headers: { 'X-Art-Secret': 'nope' }
    })
    expect(wrong.status).toBe(404)
    const del = await exports.default.fetch(`${BASE}/art/${id}`, {
      method: 'DELETE',
      headers: { 'X-Art-Secret': secret }
    })
    expect(del.status).toBe(204)
    expect((await exports.default.fetch(`${BASE}/art/${id}`)).status).toBe(404)
  })

  it('expires by itself', async () => {
    const { id } = (await (await upload(jpeg(), '5.5.5.5')).json()) as { id: string }
    expect(await runDurableObjectAlarm(env.ART_STORE.getByName(id))).toBe(true)
    expect((await exports.default.fetch(`${BASE}/art/${id}`)).status).toBe(404)
  })

  it('refuses non-images, big files and floods', async () => {
    expect((await upload(new Uint8Array([1, 2, 3]), '6.6.6.6')).status).toBe(415)
    expect((await upload(jpeg(ART_MAX_BYTES + 1), '6.6.6.7')).status).toBe(413)
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) statuses.push((await upload(jpeg(), '9.9.9.9')).status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(20)
    expect(statuses.at(-1)).toBe(429)
  })

  it('404s unknown and malformed ids', async () => {
    expect((await exports.default.fetch(`${BASE}/art/${'a'.repeat(32)}`)).status).toBe(404)
    expect((await exports.default.fetch(`${BASE}/art/xyz`)).status).toBe(404)
  })
})
