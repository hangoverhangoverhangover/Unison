import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { SpotifyApi } from './api'
import { CREATED_PLAYLIST_DESCRIPTION, SpotifyProvider } from './provider'
import { json, rejection, scriptedFetch, type Responder } from './testing'

function setup(...responders: Responder[]): {
  provider: SpotifyProvider
  fetch: ReturnType<typeof scriptedFetch>
} {
  const fetch = scriptedFetch(...responders)
  const api = new SpotifyApi(
    { getAccessToken: async () => 'at', refresh: async () => 'at' },
    { fetch, sleep: async () => {} }
  )
  return { provider: new SpotifyProvider({ api, getUserId: async () => 'me' }), fetch }
}

const sp = (id: string): Track => ({
  id: `spotify:${id}`,
  provider: 'spotify',
  nativeId: id,
  title: id,
  artists: ['A'],
  durationMs: 1
})

const CREATED = { id: 'newpl', name: 'Copy', owner: { id: 'me', display_name: 'Me' }, images: [] }

describe('SpotifyProvider.createPlaylist', () => {
  it('POSTs /me/playlists (private, described) then adds items 100 at a time', async () => {
    const { provider, fetch } = setup(
      () => json(CREATED, 201),
      () => json({ snapshot_id: 's' }, 201)
    )
    const tracks = Array.from({ length: 205 }, (_, i) => sp(`t${i}`))
    const playlist = await provider.createPlaylist(' Copy ', tracks)

    expect(fetch.calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ['POST', '/v1/me/playlists'],
      ['POST', '/v1/playlists/newpl/items'],
      ['POST', '/v1/playlists/newpl/items'],
      ['POST', '/v1/playlists/newpl/items']
    ])
    expect(JSON.parse(fetch.calls[0]!.body!)).toEqual({
      name: 'Copy',
      public: false,
      description: CREATED_PLAYLIST_DESCRIPTION
    })
    expect(CREATED_PLAYLIST_DESCRIPTION).toBe('Copied with Unison')
    const bodies = fetch.calls.slice(1).map((c) => JSON.parse(c.body!) as { uris: string[] })
    expect(bodies.map((b) => b.uris.length)).toEqual([100, 100, 5])
    expect(bodies[0]!.uris[0]).toBe('spotify:track:t0')
    expect(bodies[2]!.uris[4]).toBe('spotify:track:t204')
    expect(playlist).toMatchObject({
      id: 'spotify:newpl',
      source: 'spotify',
      nativeId: 'newpl',
      name: 'Copy',
      canEdit: true,
      trackCount: 205
    })
  })

  it('rejects non-Spotify tracks and empty names before any request', async () => {
    const { provider, fetch } = setup(() => json(CREATED))
    const sc: Track = { ...sp('x'), id: 'soundcloud:1', provider: 'soundcloud', nativeId: '1' }
    await expect(provider.createPlaylist('Copy', [sp('a'), sc])).rejects.toThrow(/Not a Spotify/)
    await expect(provider.createPlaylist('  ', [sp('a')])).rejects.toThrow(/name/)
    expect(fetch.calls).toHaveLength(0)
  })

  it('says the playlist exists when adding tracks fails', async () => {
    const { provider } = setup(
      () => json(CREATED, 201),
      () => json({ error: { status: 403, message: 'nope' } }, 403)
    )
    const err = await rejection(provider.createPlaylist('Copy', [sp('a')]))
    expect(err.message).toMatch(/Created the Spotify playlist "Copy", but adding its tracks failed/)
  })
})
