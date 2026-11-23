import { describe, expect, it } from 'vitest'
import { REUPLOAD_AFTER_MS, createRelayArt } from './relayArt'

function setup(opts: { enabled?: boolean; base?: string | null; cover?: boolean } = {}): {
  art: ReturnType<typeof createRelayArt>
  calls: { url: string; method: string }[]
  tick(ms: number): number
} {
  const calls: { url: string; method: string }[] = []
  let n = 0
  let t = 0
  const art = createRelayArt({
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      if (init?.method === 'POST') {
        n++
        return new Response(JSON.stringify({ id: `id${n}`, secret: `s${n}` }), { status: 201 })
      }
      return new Response(null, { status: 204 })
    },
    baseUrl: () => (opts.base === undefined ? 'https://relay.example/' : opts.base),
    enabled: () => opts.enabled ?? true,
    readCover: async () => (opts.cover === false ? null : new Uint8Array([0xff, 0xd8, 0xff])),
    now: () => t
  })
  return { art, calls, tick: (ms: number) => (t += ms) }
}

describe('relay cover art', () => {
  it('uploads once per cover and reuses it', async () => {
    const { art, calls } = setup()
    expect(await art.urlFor('aa')).toBe('https://relay.example/art/id1')
    expect(await art.urlFor('aa')).toBe('https://relay.example/art/id1')
    expect(art.cached('aa')).toBe('https://relay.example/art/id1')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('takes the previous image down when the song changes, and on stop', async () => {
    const { art, calls } = setup()
    await art.urlFor('aa')
    await art.urlFor('bb')
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toContainEqual({ url: 'https://relay.example/art/id1', method: 'DELETE' })
    await art.release()
    expect(calls).toContainEqual({ url: 'https://relay.example/art/id2', method: 'DELETE' })
    expect(art.cached('bb')).toBeUndefined()
  })

  it('uploads again before the relay would expire it', async () => {
    const { art, tick } = setup()
    await art.urlFor('aa')
    tick(REUPLOAD_AFTER_MS)
    expect(art.cached('aa')).toBeUndefined()
    expect(await art.urlFor('aa')).toBe('https://relay.example/art/id2')
  })

  it('does nothing when off, without a relay, or for a file without a cover', async () => {
    expect(await setup({ enabled: false }).art.urlFor('aa')).toBeNull()
    expect(await setup({ base: null }).art.urlFor('aa')).toBeNull()
    expect(await setup({ cover: false }).art.urlFor('aa')).toBeNull()
  })
})
