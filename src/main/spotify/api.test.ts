import { describe, expect, it, vi, type Mock } from 'vitest'
import { retryAfterSeconds, SpotifyApi, SpotifyApiError, SpotifyQuotaError } from './api'
import { json, rejection, scriptedFetch, type Responder, type ScriptedFetch } from './testing'

interface Harness {
  api: SpotifyApi
  fetch: ScriptedFetch
  auth: { getAccessToken: Mock<() => Promise<string>>; refresh: Mock<() => Promise<string>> }
  sleep: Mock<(ms: number) => Promise<void>>
}

function setup(...responders: Responder[]): Harness {
  const fetch = scriptedFetch(...responders)
  let token = 'at-1'
  const auth = {
    getAccessToken: vi.fn(async () => token),
    refresh: vi.fn(async () => (token = 'at-2'))
  }
  const sleep: Harness['sleep'] = vi.fn(async () => {})
  const api = new SpotifyApi(auth, { fetch, sleep })
  return { api, fetch, auth, sleep }
}

describe('SpotifyApi.request', () => {
  it('sends the bearer token and query, and parses JSON', async () => {
    const { api, fetch } = setup(() => json({ ok: 1 }))
    await expect(api.get('/me', { a: 'x y', b: undefined })).resolves.toEqual({ ok: 1 })
    expect(fetch.calls[0]!.url).toBe('https://api.spotify.com/v1/me?a=x+y')
    expect(fetch.calls[0]!.headers.Authorization).toBe('Bearer at-1')
  })

  it('returns undefined for empty bodies', async () => {
    const { api } = setup(() => new Response(null, { status: 204 }))
    await expect(api.request('PUT', '/me/player')).resolves.toBeUndefined()
  })

  it('JSON-encodes bodies', async () => {
    const { api, fetch } = setup(() => json(undefined, 200))
    await api.request('PUT', '/x', { body: { a: 1 } })
    expect(fetch.calls[0]!.body).toBe('{"a":1}')
    expect(fetch.calls[0]!.headers['Content-Type']).toBe('application/json')
  })

  it('refreshes once on 401 and retries', async () => {
    const { api, fetch, auth } = setup(
      () => json({ error: { status: 401, message: 'The access token expired' } }, 401),
      () => json({ id: 'u' })
    )
    await expect(api.get('/me')).resolves.toEqual({ id: 'u' })
    expect(auth.refresh).toHaveBeenCalledOnce()
    expect(fetch.calls[1]!.headers.Authorization).toBe('Bearer at-2')
  })

  it('gives up after a second 401', async () => {
    const { api, fetch, auth } = setup(() => json({ error: { status: 401, message: 'nope' } }, 401))
    const err = await rejection<SpotifyApiError>(api.get('/me'))
    expect(err).toBeInstanceOf(SpotifyApiError)
    expect(err.status).toBe(401)
    expect(err.spotifyMessage).toBe('nope')
    expect(auth.refresh).toHaveBeenCalledOnce()
    expect(fetch.calls).toHaveLength(2)
  })

  it('honours Retry-After on 429, capped at 30s', async () => {
    const { api, sleep } = setup(
      () => json({ error: { status: 429, message: 'rate' } }, 429, { 'Retry-After': '3' }),
      () => json({ error: { status: 429, message: 'rate' } }, 429, { 'Retry-After': '120' }),
      () => json({ ok: true })
    )
    await expect(api.get('/me')).resolves.toEqual({ ok: true })
    expect(sleep.mock.calls).toEqual([[3000], [30000]])
  })

  it('stops after two 429 retries', async () => {
    const { api, fetch } = setup(() => json({}, 429, { 'Retry-After': '1' }))
    const err = await rejection<SpotifyApiError>(api.get('/me'))
    expect(err.status).toBe(429)
    expect(fetch.calls).toHaveLength(3)
  })

  it('does not retry QUOTA_EXCEEDED', async () => {
    const { api, fetch, sleep } = setup(() =>
      json({ status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' }, 429, {
        'Retry-After': '1'
      })
    )
    const err = await rejection<SpotifyApiError>(api.get('/me'))
    expect(err).toBeInstanceOf(SpotifyQuotaError)
    expect(err.message).toMatch(/quota/i)
    expect(fetch.calls).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws typed errors with status, message and reason', async () => {
    const { api } = setup(() =>
      json(
        { error: { status: 404, message: 'Player command failed', reason: 'NO_ACTIVE_DEVICE' } },
        404
      )
    )
    const err = await rejection<SpotifyApiError>(api.request('PUT', '/me/player/play'))
    expect(err).toMatchObject({
      status: 404,
      reason: 'NO_ACTIVE_DEVICE',
      spotifyMessage: 'Player command failed'
    })
    expect(err.message).toContain('Player command failed')
  })

  it('refuses to send the token to other hosts', async () => {
    const { api } = setup(() => json({}))
    await expect(api.get('https://evil.example/v1/me')).rejects.toThrow(/non-Spotify/)
  })

  it('parses Retry-After values', () => {
    expect(retryAfterSeconds('5')).toBe(5)
    expect(retryAfterSeconds(null)).toBe(1)
    expect(retryAfterSeconds(new Date(10_000).toUTCString(), 4_000)).toBe(6)
  })
})

describe('SpotifyApi.getAllPages', () => {
  it('follows next links and keeps nulls for the caller', async () => {
    const { api, fetch } = setup(
      () =>
        json({ items: [1, null], next: 'https://api.spotify.com/v1/me/tracks?offset=2&limit=2' }),
      () => json({ items: [3], next: null })
    )
    await expect(api.getAllPages('/me/tracks', { limit: 2 })).resolves.toEqual([1, null, 3])
    expect(fetch.calls.map((c) => c.url)).toEqual([
      'https://api.spotify.com/v1/me/tracks?limit=2',
      'https://api.spotify.com/v1/me/tracks?offset=2&limit=2'
    ])
  })

  it('fetches remaining pages by offset in parallel and keeps their order', async () => {
    // Respond by offset, with later pages answering first to prove ordering holds.
    const { api, fetch } = setup(async (call) => {
      const offset = Number(new URL(call.url).searchParams.get('offset') ?? 0)
      if (offset === 0) {
        return json({
          items: [0, 1],
          total: 7,
          next: 'https://api.spotify.com/v1/me/tracks?offset=2&limit=2'
        })
      }
      await new Promise((r) => setTimeout(r, 10 - offset))
      return json({ items: [offset, offset + 1].filter((n) => n < 7), next: null })
    })
    await expect(api.getAllPages('/me/tracks', { limit: 2 })).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6
    ])
    const offsets = fetch.calls.map((c) => new URL(c.url).searchParams.get('offset'))
    expect(offsets).toHaveLength(4)
    expect(new Set(offsets)).toEqual(new Set([null, '2', '4', '6']))
  })
})
