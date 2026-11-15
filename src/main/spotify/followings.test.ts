import { describe, expect, it } from 'vitest'
import { SPOTIFY_SCOPES } from '@shared/spotify'
import { SpotifyApi } from './api'
import type { TokenResponse } from './auth'
import {
  FOLLOW_SCOPE_MESSAGE,
  FOLLOWING_LIMIT,
  FOLLOWING_MAX,
  SpotifyFollowScopeError,
  SpotifyProvider
} from './provider'
import { SpotifySession } from './session'
import { fakeBox, json, memorySettings, scriptedFetch, type Call, type Responder } from './testing'

const artist = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  type: 'artist',
  images: [{ url: `img-${id}`, width: 640, height: 640 }],
  external_urls: { spotify: `https://open.spotify.com/artist/${id}` }
})

/** One `/me/following` page; `after` is the last id when there is a next page. */
const page = (items: Record<string, unknown>[], hasNext: boolean): Response =>
  json({
    artists: {
      items,
      limit: FOLLOWING_LIMIT,
      next: hasNext ? 'https://api.spotify.com/v1/me/following?type=artist&after=x' : null,
      cursors: { after: hasNext ? (items.at(-1)?.id ?? null) : null },
      href: 'https://api.spotify.com/v1/me/following?type=artist'
    }
  })

function setup(handler: (url: URL) => Response): { provider: SpotifyProvider; calls: Call[] } {
  const fetch = scriptedFetch((call) => handler(new URL(call.url)))
  const api = new SpotifyApi(
    { getAccessToken: async () => 'at', refresh: async () => 'at' },
    { fetch, sleep: async () => {} }
  )
  return { provider: new SpotifyProvider({ api, getUserId: async () => 'me' }), calls: fetch.calls }
}

describe('SpotifyProvider.getFollowedArtists', () => {
  it('follows the after cursor to the end, maps and sorts by name', async () => {
    const { provider, calls } = setup((u) => {
      if (u.pathname !== '/v1/me/following') return json({}, 404)
      const after = u.searchParams.get('after')
      if (!after) return page([artist('a1', 'zeta'), artist('a2', 'Alpha')], true)
      if (after === 'a2') return page([artist('a3', 'beta'), artist('a1', 'zeta')], true)
      return page([artist('a4', 'Gamma')], false)
    })
    const artists = await provider.getFollowedArtists()
    expect(artists.map((a) => a.name)).toEqual(['Alpha', 'beta', 'Gamma', 'zeta'])
    expect(artists[0]).toEqual({
      id: 'spotify:a2',
      provider: 'spotify',
      nativeId: 'a2',
      name: 'Alpha',
      url: 'https://open.spotify.com/artist/a2',
      imageUrl: 'img-a2'
    })
    const queries = calls.map((c) => Object.fromEntries(new URL(c.url).searchParams))
    expect(queries).toEqual([
      { type: 'artist', limit: '50' },
      { type: 'artist', limit: '50', after: 'a2' },
      { type: 'artist', limit: '50', after: 'a1' }
    ])
  })

  it(`stops at ${FOLLOWING_MAX} artists`, async () => {
    let n = 0
    const { provider, calls } = setup(() =>
      page(
        Array.from({ length: FOLLOWING_LIMIT }, () => {
          n++
          return artist(`id${n}`, `Artist ${n}`)
        }),
        true
      )
    )
    const artists = await provider.getFollowedArtists()
    expect(artists).toHaveLength(FOLLOWING_MAX)
    expect(calls).toHaveLength(FOLLOWING_MAX / FOLLOWING_LIMIT)
  })

  it('turns a 403 about scopes into the log-in-again message; other errors pass through', async () => {
    const scope = setup(() =>
      json({ error: { status: 403, message: 'Insufficient client scope' } }, 403)
    )
    const err = await scope.provider.getFollowedArtists().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SpotifyFollowScopeError)
    expect((err as Error).message).toBe(FOLLOW_SCOPE_MESSAGE)

    const other = setup(() => json({ error: { status: 500, message: 'boom' } }, 500))
    await expect(other.provider.getFollowedArtists()).rejects.toThrow(/500/)
  })
})

describe('SpotifySession.getFollowings', () => {
  const tokens = (scope: string): TokenResponse => ({
    access_token: 'at',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'rt',
    scope
  })

  function session(scope: string | null, ...responders: Responder[]): SpotifySession {
    return new SpotifySession({
      clientId: 'cid',
      box: fakeBox(),
      settings: memorySettings(),
      fetch: scriptedFetch(() => json({ id: 'u1', display_name: 'U' }), ...responders),
      login: async () => tokens(scope ?? ''),
      openExternal: () => {},
      onStatus: () => {}
    })
  }

  it('says not connected before login', async () => {
    await expect(session(null).getFollowings()).rejects.toThrow("Spotify isn't connected")
  })

  it('keeps logins without user-follow-read connected, but asks to log in again here', async () => {
    const s = session(SPOTIFY_SCOPES.join(' '))
    await s.login()
    expect(s.status.state).toBe('connected')
    await expect(s.getFollowings()).rejects.toThrow(FOLLOW_SCOPE_MESSAGE)
  })

  it('reads followings when the scope was granted', async () => {
    const s = session([...SPOTIFY_SCOPES, 'user-follow-read'].join(' '), () =>
      page([artist('a1', 'One')], false)
    )
    await s.login()
    await expect(s.getFollowings()).resolves.toMatchObject([{ id: 'spotify:a1', name: 'One' }])
  })
})
