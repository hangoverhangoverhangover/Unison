import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { SpotifyApi } from './api'
import { mapPlaylist, mapPlaylistItem, mapTrack, pickImage, type SpTrack } from './mapping'
import { MAX_PLAY_URIS, play, waitForDevice } from './player'
import { SpotifyPlaylistUnreadableError, SpotifyProvider } from './provider'
import { json, scriptedFetch, type Responder, type ScriptedFetch } from './testing'

function setup(...responders: Responder[]): {
  api: SpotifyApi
  provider: SpotifyProvider
  fetch: ScriptedFetch
} {
  const fetch = scriptedFetch(...responders)
  const api = new SpotifyApi(
    { getAccessToken: async () => 'at', refresh: async () => 'at' },
    { fetch, sleep: async () => {} }
  )
  const provider = new SpotifyProvider({ api, getUserId: async () => 'me' })
  return { api, provider, fetch }
}

const raw = (id: string, extra: Partial<SpTrack> = {}): SpTrack => ({
  id,
  type: 'track',
  name: `Song ${id}`,
  duration_ms: 1000,
  artists: [{ name: 'A' }, { name: 'B' }],
  album: { name: 'Alb', images: [] },
  ...extra
})

const TRACK: Track = {
  id: 'spotify:abc',
  provider: 'spotify',
  nativeId: 'abc',
  title: 't',
  artists: [],
  durationMs: 1
}

describe('mapping', () => {
  it('maps a track', () => {
    expect(
      mapTrack(
        raw('abc', {
          external_ids: { isrc: 'USX1' },
          album: {
            name: 'Alb',
            images: [
              { url: 'big', width: 1000, height: 1000 },
              { url: 'mid', width: 640, height: 640 },
              { url: 'small', width: 64, height: 64 }
            ]
          }
        })
      )
    ).toEqual({
      id: 'spotify:abc',
      provider: 'spotify',
      nativeId: 'abc',
      title: 'Song abc',
      artists: ['A', 'B'],
      album: 'Alb',
      durationMs: 1000,
      artworkUrl: 'mid',
      isrc: 'USX1',
      url: 'https://open.spotify.com/track/abc'
    })
  })

  it('skips null, local, episode and id-less tracks', () => {
    expect(mapTrack(null)).toBeNull()
    expect(mapTrack(raw('a', { is_local: true }))).toBeNull()
    expect(mapTrack(raw('a', { type: 'episode' }))).toBeNull()
    expect(mapTrack(raw('a', { id: null }))).toBeNull()
  })

  it('picks the largest image no wider than 640px', () => {
    expect(
      pickImage([
        { url: 'a', width: 300 },
        { url: 'b', width: 600 },
        { url: 'c', width: 641 }
      ])
    ).toBe('b')
    expect(pickImage([{ url: 'x', width: null, height: null }])).toBe('x')
    expect(
      pickImage([
        { url: 'h', width: 2000 },
        { url: 'i', width: 900 }
      ])
    ).toBe('i')
    expect(pickImage([])).toBeUndefined()
    expect(pickImage(null)).toBeUndefined()
  })

  it('reads playlist items from item, falling back to track', () => {
    expect(mapPlaylistItem({ item: raw('i') })?.nativeId).toBe('i')
    expect(mapPlaylistItem({ track: raw('t') })?.nativeId).toBe('t')
    expect(mapPlaylistItem({ item: null, track: null })).toBeNull()
    expect(mapPlaylistItem({ is_local: true, item: raw('l') })).toBeNull()
    expect(mapPlaylistItem(null)).toBeNull()
  })

  it('maps playlists with ownership and counts', () => {
    expect(
      mapPlaylist(
        {
          id: 'p1',
          name: 'Mine',
          owner: { id: 'me', display_name: 'Me' },
          images: [{ url: 'img', width: null, height: null }],
          items: { total: 7 }
        },
        'me'
      )
    ).toEqual({
      id: 'spotify:p1',
      source: 'spotify',
      nativeId: 'p1',
      name: 'Mine',
      ownerName: 'Me',
      artworkUrl: 'img',
      trackCount: 7,
      canEdit: true
    })
    const other = { id: 'p2', name: 'Theirs', owner: { id: 'x' }, tracks: { total: 3 } }
    expect(mapPlaylist(other, 'me')).toMatchObject({ canEdit: false, trackCount: 3 })
    expect(mapPlaylist({ ...other, collaborative: true }, 'me')?.canEdit).toBe(true)
    expect(mapPlaylist(null, 'me')).toBeNull()
  })
})

describe('SpotifyProvider', () => {
  it('pages all liked songs, skips nulls, newest first', async () => {
    const { provider, fetch } = setup(
      () =>
        json({
          items: [
            { added_at: '2026-03-01T00:00:00Z', track: raw('b') },
            { added_at: '2026-02-01T00:00:00Z', track: null },
            null
          ],
          next: 'https://api.spotify.com/v1/me/tracks?offset=50&limit=50'
        }),
      () => json({ items: [{ added_at: '2026-04-01T00:00:00Z', track: raw('c') }], next: null })
    )
    const likes = await provider.getLikes()
    expect(likes.map((l) => [l.track.nativeId, l.likedAt])).toEqual([
      ['c', '2026-04-01T00:00:00Z'],
      ['b', '2026-03-01T00:00:00Z']
    ])
    expect(fetch.calls[0]!.url).toBe('https://api.spotify.com/v1/me/tracks?limit=50')
  })

  it('likes with uris in the query string', async () => {
    const { provider, fetch } = setup(() => json(undefined))
    await provider.like(TRACK)
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0]!.method).toBe('PUT')
    expect(fetch.calls[0]!.url).toBe(
      'https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Aabc'
    )
    expect(fetch.calls[0]!.body).toBeUndefined()
  })

  it('falls back to a JSON body on 400 and remembers it', async () => {
    const { provider, fetch } = setup(
      () => json({ error: { status: 400, message: 'Missing body' } }, 400),
      () => json(undefined)
    )
    await provider.unlike(TRACK)
    expect(fetch.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['DELETE', 'https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Aabc', undefined],
      ['DELETE', 'https://api.spotify.com/v1/me/library', '{"uris":["spotify:track:abc"]}']
    ])
    await provider.like(TRACK)
    expect(fetch.calls[2]!.body).toBe('{"uris":["spotify:track:abc"]}')
  })

  it('does not retry non-400 like failures', async () => {
    const { provider, fetch } = setup(() => json({ error: { status: 403, message: 'x' } }, 403))
    await expect(provider.like(TRACK)).rejects.toMatchObject({ status: 403 })
    expect(fetch.calls).toHaveLength(1)
  })

  it('rejects non-Spotify and malformed ids', async () => {
    const { provider, fetch } = setup(() => json(undefined))
    await expect(provider.like({ ...TRACK, provider: 'soundcloud' })).rejects.toThrow()
    await expect(provider.like({ ...TRACK, nativeId: 'a,spotify:track:b' })).rejects.toThrow()
    expect(fetch.calls).toHaveLength(0)
  })

  it('checks likes 40 at a time', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `id${i}`)
    const { provider, fetch } = setup(
      () => json(Array.from({ length: 40 }, (_, i) => i % 2 === 0)),
      () => json([true, false, false, false, true])
    )
    const res = await provider.isLiked(ids)
    expect(fetch.calls).toHaveLength(2)
    expect(new URL(fetch.calls[0]!.url).searchParams.get('uris')!.split(',')).toHaveLength(40)
    expect(new URL(fetch.calls[0]!.url).pathname).toBe('/v1/me/library/contains')
    expect(res.id0).toBe(true)
    expect(res.id1).toBe(false)
    expect(res.id40).toBe(true)
    expect(res.id44).toBe(true)
  })

  it('lists playlists over all pages', async () => {
    const { provider, fetch } = setup(
      () =>
        json({
          items: [{ id: 'p1', name: 'A', owner: { id: 'me' } }, null],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50'
        }),
      () => json({ items: [{ id: 'p2', name: 'B', owner: { id: 'x' } }], next: null })
    )
    const lists = await provider.getPlaylists()
    expect(lists.map((p) => [p.id, p.canEdit])).toEqual([
      ['spotify:p1', true],
      ['spotify:p2', false]
    ])
    expect(fetch.calls[0]!.url).toBe('https://api.spotify.com/v1/me/playlists?limit=50')
  })

  it('reads playlist items and skips local/null/episodes', async () => {
    const { provider, fetch } = setup(() =>
      json({
        items: [
          { item: raw('a') },
          { track: raw('b') },
          { is_local: true, item: raw('c') },
          { item: null },
          { item: raw('e', { type: 'episode' }) }
        ],
        next: null
      })
    )
    const tracks = await provider.getPlaylistTracks('spotify:pl1')
    expect(tracks.map((t) => t.nativeId)).toEqual(['a', 'b'])
    const url = new URL(fetch.calls[0]!.url)
    expect(url.pathname).toBe('/v1/playlists/pl1/items')
    expect(url.searchParams.get('limit')).toBe('50')
  })

  it('explains a 403 on playlist items', async () => {
    const { provider } = setup(() => json({ error: { status: 403, message: 'Forbidden' } }, 403))
    const err = await provider.getPlaylistTracks('spotify:pl1').catch((e) => e)
    expect(err).toBeInstanceOf(SpotifyPlaylistUnreadableError)
    expect(err.message).toMatch(/own or collaborate/)
  })

  it('searches 10 per page with offset', async () => {
    const { provider, fetch } = setup(() => json({ tracks: { items: [raw('s'), null] } }))
    const res = await provider.search(' hello ', 2)
    expect(res.map((t) => t.nativeId)).toEqual(['s'])
    expect(Object.fromEntries(new URL(fetch.calls[0]!.url).searchParams)).toEqual({
      q: 'hello',
      type: 'track',
      limit: '10',
      offset: '20'
    })
    await expect(provider.search('x', 101)).resolves.toEqual([])
    await expect(provider.search('  ', 0)).resolves.toEqual([])
    expect(fetch.calls).toHaveLength(1)
  })

  it('passes an isrc: field filter through as q=isrc:<code>', async () => {
    const { provider, fetch } = setup(() =>
      json({ tracks: { items: [raw('s', { external_ids: { isrc: 'USRC11700001' } })] } })
    )
    const res = await provider.search('isrc:USRC11700001', 0)
    expect(res[0]!.isrc).toBe('USRC11700001')
    const url = new URL(fetch.calls[0]!.url)
    expect(url.searchParams.get('q')).toBe('isrc:USRC11700001')
    // URLSearchParams sends the colon as %3A, which decodes to the same query.
    expect(url.search).toMatch(/[?&]q=isrc%3AUSRC11700001(&|$)/)
  })
})

describe('play', () => {
  it('starts playback on the device', async () => {
    const { api, fetch } = setup(() => new Response(null, { status: 204 }))
    await play(api, 'dev1', ['a', 'b'], 1234.7)
    expect(fetch.calls[0]!.method).toBe('PUT')
    expect(fetch.calls[0]!.url).toBe('https://api.spotify.com/v1/me/player/play?device_id=dev1')
    expect(JSON.parse(fetch.calls[0]!.body!)).toEqual({
      uris: ['spotify:track:a', 'spotify:track:b'],
      position_ms: 1234
    })
  })

  it('caps uris', async () => {
    const { api, fetch } = setup(() => new Response(null, { status: 204 }))
    await play(
      api,
      'dev1',
      Array.from({ length: 150 }, (_, i) => `t${i}`),
      0
    )
    expect(JSON.parse(fetch.calls[0]!.body!).uris).toHaveLength(MAX_PLAY_URIS)
  })

  it('transfers then retries once on 404', async () => {
    const { api, fetch } = setup(
      () =>
        json(
          {
            error: {
              status: 404,
              message: 'Player command failed: No active device found',
              reason: 'NO_ACTIVE_DEVICE'
            }
          },
          404
        ),
      () => json({ devices: [{ id: 'dev1', name: 'Unison', type: 'Computer' }] }),
      () => new Response(null, { status: 204 }),
      () => new Response(null, { status: 204 })
    )
    await play(api, 'dev1', ['a'], 0)
    expect(fetch.calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ['PUT', '/v1/me/player/play'],
      ['GET', '/v1/me/player/devices'],
      ['PUT', '/v1/me/player'],
      ['PUT', '/v1/me/player/play']
    ])
    expect(JSON.parse(fetch.calls[2]!.body!)).toEqual({ device_ids: ['dev1'], play: false })
  })

  it('does not loop when the retry also 404s', async () => {
    const { api, fetch } = setup(
      () => json({ error: { status: 404, message: 'no' } }, 404),
      () => json({ devices: [{ id: 'dev1' }] }),
      () => new Response(null, { status: 204 }),
      () => json({ error: { status: 404, message: 'no' } }, 404)
    )
    await expect(play(api, 'dev1', ['a'], 0)).rejects.toMatchObject({ status: 404 })
    expect(fetch.calls).toHaveLength(4)
  })

  it('waits for the SDK device to appear, then gives up with a clear error', async () => {
    const sleep = async (): Promise<void> => {}
    let calls = 0
    const { api } = setup(() => {
      calls++
      return json({ devices: calls >= 3 ? [{ id: 'dev1' }] : [{ id: 'phone' }] })
    })
    await waitForDevice(api, 'dev1', { sleep })
    expect(calls).toBe(3)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const none = setup(() => json({ devices: [] }))
    await expect(waitForDevice(none.api, 'dev1', { timeoutMs: 0, sleep })).rejects.toThrow(
      /can't see this app's player/
    )
    warn.mockRestore()
  })

  it('rejects empty lists and bad device ids', async () => {
    const { api } = setup(() => json(undefined))
    await expect(play(api, 'dev1', [], 0)).rejects.toThrow(/Nothing to play/)
    await expect(play(api, 'dev&x=1', ['a'], 0)).rejects.toThrow(/device/)
  })
})

describe('SpotifyProvider playlist editing', () => {
  const sp = (id: string): Track => ({ ...TRACK, id: `spotify:${id}`, nativeId: id })

  it('adds 100 URIs per POST, in order', async () => {
    const { provider, fetch } = setup(() => json({ snapshot_id: 's' }, 201))
    const tracks = Array.from({ length: 205 }, (_, i) => sp(`t${i}`))
    await provider.addToPlaylist('spotify:pl1', tracks)
    expect(fetch.calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ['POST', '/v1/playlists/pl1/items'],
      ['POST', '/v1/playlists/pl1/items'],
      ['POST', '/v1/playlists/pl1/items']
    ])
    const bodies = fetch.calls.map((c) => JSON.parse(c.body!) as { uris: string[] })
    expect(bodies.map((b) => b.uris.length)).toEqual([100, 100, 5])
    expect(bodies[0]!.uris[0]).toBe('spotify:track:t0')
    expect(bodies[2]!.uris[4]).toBe('spotify:track:t204')
    expect(Object.keys(bodies[0]!)).toEqual(['uris'])
  })

  it('removes with DELETE { items: [{ uri }] }, deduped, 100 per call', async () => {
    const { provider, fetch } = setup(() => json({ snapshot_id: 's' }))
    const tracks = [...Array.from({ length: 150 }, (_, i) => sp(`t${i}`)), sp('t0')]
    await provider.removeFromPlaylist('spotify:pl1', tracks)
    expect(fetch.calls.map((c) => c.method)).toEqual(['DELETE', 'DELETE'])
    expect(new URL(fetch.calls[0]!.url).pathname).toBe('/v1/playlists/pl1/items')
    const bodies = fetch.calls.map((c) => JSON.parse(c.body!) as { items: { uri: string }[] })
    expect(bodies.map((b) => b.items.length)).toEqual([100, 50])
    expect(bodies[0]!.items[0]).toEqual({ uri: 'spotify:track:t0' })
  })

  it('rejects other services, bad ids and non-Spotify playlist ids before any request', async () => {
    const { provider, fetch } = setup(() => json({}))
    const sc: Track = { ...TRACK, id: 'soundcloud:1', provider: 'soundcloud', nativeId: '1' }
    await expect(provider.addToPlaylist('spotify:pl1', [sc])).rejects.toThrow(/Not a Spotify/)
    await expect(provider.addToPlaylist('soundcloud:1', [sp('a')])).rejects.toThrow(
      /Not a Spotify playlist/
    )
    await expect(provider.removeFromPlaylist('spotify:p/x', [sp('a')])).rejects.toThrow(
      /Invalid Spotify playlist id/
    )
    expect(fetch.calls).toHaveLength(0)
  })
})
