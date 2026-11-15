import { describe, expect, it, vi } from 'vitest'
import { UnplayableTrackError } from '@shared/provider'
import type { Track } from '@shared/types'
import { SoundCloudApi, SoundCloudNotConnectedError } from './api'
import { ClientIdStore } from './clientId'
import type { ScTrack, ScTranscoding } from './mapping'
import {
  ARTIST_TRACKS_MAX,
  HYDRATE_BATCH,
  SoundCloudWebProvider,
  UNPLAYABLE_MESSAGES
} from './provider'
import { json, rejection, routedFetch, settingsWithClientId, silentLog, type Call } from './testing'

const ME = { id: '9', username: 'me' }

function hls(preset: string, extra: Partial<ScTranscoding> = {}): ScTranscoding {
  return {
    url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/${preset}/stream/hls`,
    preset,
    snipped: false,
    format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' },
    ...extra
  }
}

function track(id: number, over: Partial<ScTrack> = {}): ScTrack {
  return {
    id,
    kind: 'track',
    title: `T${id}`,
    duration: 1000,
    user: { id: 1, username: 'artist' },
    track_authorization: `auth-${id}`,
    media: { transcodings: [hls('aac_96k'), hls('aac_160k')] },
    waveform_url: `https://wave.sndcdn.com/w${id}_m.json`,
    ...over
  }
}

interface Harness {
  provider: SoundCloudWebProvider
  fetch: ReturnType<typeof routedFetch>
  path: (c: Call) => string
  advance: (ms: number) => number
}

function setup(
  handler: (call: Call, url: URL) => Response | Promise<Response>,
  opts: { loggedIn?: boolean; now?: number } = {}
): Harness {
  const loggedIn = opts.loggedIn ?? true
  const fetch = routedFetch(handler)
  const clientIds = new ClientIdStore({ fetch, settings: settingsWithClientId(), log: silentLog })
  const api = new SoundCloudApi({
    fetch,
    clientIds,
    auth: {
      getToken: async () => (loggedIn ? 'tok' : null),
      refresh: async () => null,
      onExpired: () => undefined
    },
    sleep: async () => {},
    log: silentLog
  })
  let now = opts.now ?? 1_000_000
  const provider = new SoundCloudWebProvider({
    api,
    fetch,
    requireUser: async () => {
      if (!loggedIn) throw new SoundCloudNotConnectedError()
      return ME
    },
    now: () => now
  })
  const path = (c: Call): string => new URL(c.url).pathname
  return {
    provider,
    fetch,
    path,
    advance: (ms: number) => (now += ms)
  }
}

const scTrack = (id: string): Track => ({
  id: `soundcloud:${id}`,
  provider: 'soundcloud',
  nativeId: id,
  title: 't',
  artists: [],
  durationMs: 0
})

describe('SoundCloudWebProvider', () => {
  it('pages likes via next_href, skips non-tracks, newest first', async () => {
    const { provider, fetch } = setup((_c, u) => {
      if (!u.searchParams.has('cursor'))
        return json({
          collection: [
            { created_at: '2026-01-01T00:00:00Z', kind: 'like', track: track(1) },
            { created_at: '2026-03-01T00:00:00Z', kind: 'like', track: null },
            { created_at: '2026-02-01T00:00:00Z', kind: 'like', playlist: { id: 5 } }
          ],
          next_href: 'https://api-v2.soundcloud.com/users/9/track_likes?cursor=abc&limit=200'
        })
      return json({
        collection: [{ created_at: '2026-05-01T00:00:00Z', kind: 'like', track: track(2) }],
        next_href: null
      })
    })
    const likes = await provider.getLikes()
    expect(likes.map((l) => [l.track.nativeId, l.likedAt])).toEqual([
      ['2', '2026-05-01T00:00:00Z'],
      ['1', '2026-01-01T00:00:00Z']
    ])
    expect(new URL(fetch.calls[0]!.url).pathname).toBe('/users/9/track_likes')
    expect(new URL(fetch.calls[1]!.url).searchParams.get('client_id')).toHaveLength(32)
  })

  it('likes and unlikes with PUT/DELETE users/{me}/track_likes/{id}', async () => {
    const { provider, fetch, path } = setup(() => new Response(null, { status: 200 }))
    await provider.like(scTrack('123'))
    await provider.unlike(scTrack('123'))
    expect(fetch.calls.map((c) => `${c.method} ${path(c)}`)).toEqual([
      'PUT /users/9/track_likes/123',
      'DELETE /users/9/track_likes/123'
    ])
    expect(fetch.calls[0]!.headers.Authorization).toBe('OAuth tok')
    await expect(provider.like({ ...scTrack('1'), provider: 'spotify' })).rejects.toThrow(
      /Not a SoundCloud track/
    )
    await expect(provider.like(scTrack('../x'))).rejects.toThrow(/Invalid/)
  })

  it('isLiked reads me/track_likes/ids and caches it for a minute', async () => {
    const { provider, fetch, advance } = setup(() => json({ collection: [1, 2], next_href: null }))
    await expect(provider.isLiked(['1', '3'])).resolves.toEqual({ '1': true, '3': false })
    await provider.isLiked(['2'])
    expect(fetch.calls).toHaveLength(1)
    expect(new URL(fetch.calls[0]!.url).pathname).toBe('/me/track_likes/ids')
    advance(61_000)
    await provider.isLiked(['2'])
    expect(fetch.calls).toHaveLength(2)
  })

  it('throws not-connected for account calls when logged out', async () => {
    const { provider, fetch } = setup(() => json({}), { loggedIn: false })
    await expect(provider.getLikes()).rejects.toThrow(
      "SoundCloud isn't connected. Connect it in Settings."
    )
    await expect(provider.getPlaylists()).rejects.toThrow(/isn't connected/)
    expect(fetch.calls).toHaveLength(0)
  })

  it('searches anonymously with limit 20 and offset page*20', async () => {
    const { provider, fetch } = setup(
      () => json({ collection: [track(1), { id: 2, kind: 'user' }], next_href: null }),
      { loggedIn: false }
    )
    const res = await provider.search(' lofi ', 2)
    expect(res.map((t) => t.id)).toEqual(['soundcloud:1'])
    const u = new URL(fetch.calls[0]!.url)
    expect(u.pathname).toBe('/search/tracks')
    expect(u.searchParams.get('q')).toBe('lofi')
    expect(u.searchParams.get('limit')).toBe('20')
    expect(u.searchParams.get('offset')).toBe('40')
    expect(fetch.calls[0]!.headers.Authorization).toBeUndefined()
    await expect(provider.search('  ', 0)).resolves.toEqual([])
  })

  it('merges library playlists, deduped by id', async () => {
    const { provider } = setup(() =>
      json({
        collection: [
          { type: 'playlist', playlist: { id: 1, kind: 'playlist', title: 'Mine', user_id: 9 } },
          {
            type: 'playlist-like',
            playlist: { id: 2, kind: 'playlist', title: 'Liked', user_id: 4 }
          },
          { type: 'playlist', playlist: { id: 1, kind: 'playlist', title: 'Mine', user_id: 9 } }
        ],
        next_href: null
      })
    )
    const lists = await provider.getPlaylists()
    expect(lists.map((p) => [p.id, p.canEdit])).toEqual([
      ['soundcloud:1', true],
      ['soundcloud:2', false]
    ])
  })

  it('hydrates stub tracks in chunks of 50, keeping playlist order', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1)
    const fullIds = new Set([1, 2, 60])
    const { provider, fetch } = setup((_c, u) => {
      if (u.pathname === '/playlists/77')
        return json({
          id: 77,
          kind: 'playlist',
          tracks: ids.map((id) =>
            fullIds.has(id) ? track(id) : { id, kind: 'track', policy: 'ALLOW' }
          )
        })
      if (u.pathname === '/tracks') {
        // Reverse to prove order comes from the playlist, and drop one id.
        const req = u.searchParams.get('ids')!.split(',').map(Number)
        return json(
          req
            .filter((id) => id !== 99)
            .map((id) => track(id))
            .reverse()
        )
      }
      return json({}, 404)
    })
    const tracks = await provider.getPlaylistTracks('soundcloud:77')
    expect(tracks.map((t) => Number(t.nativeId))).toEqual(ids.filter((id) => id !== 99))
    const batches = fetch.calls
      .filter((c) => new URL(c.url).pathname === '/tracks')
      .map((c) => new URL(c.url).searchParams.get('ids')!.split(','))
    expect(batches.map((b) => b.length)).toEqual([50, 50, 17])
    expect(batches.every((b) => b.length <= HYDRATE_BATCH)).toBe(true)
    expect(batches.flat()).not.toContain('1')
    expect(new URL(fetch.calls[1]!.url).searchParams.get('playlistId')).toBe('77')
  })

  it('resolves the best clear transcoding into StreamInfo', async () => {
    const expires = 1_000_000 / 1000 + 7500 // 2 h 05 after "now"
    const { provider, fetch } = setup(
      (_c, u) => {
        if (u.pathname === '/tracks/5') return json(track(5))
        if (u.pathname.includes('/media/'))
          return json({
            url: `https://playback.media-streaming.soundcloud.cloud/x/aac_160k/y/playlist.m3u8?expires=${expires}&Signature=s`
          })
        return json({}, 404)
      },
      { loggedIn: false }
    )
    const info = await provider.getStreamUrl('5')
    expect(info).toEqual({
      url: expect.stringContaining('playlist.m3u8'),
      protocol: 'hls',
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      preview: false,
      expiresAt: expires * 1000 - 5 * 60_000
    })
    const resolve = new URL(fetch.calls[1]!.url)
    expect(resolve.pathname).toContain('/aac_160k/')
    expect(resolve.searchParams.get('track_authorization')).toBe('auth-5')
    expect(resolve.searchParams.get('client_id')).toHaveLength(32)
    // Second call reuses the cached track object.
    await provider.getStreamUrl('5')
    expect(fetch.calls.filter((c) => new URL(c.url).pathname === '/tracks/5')).toHaveLength(1)
  })

  it('throws UnplayableTrackError for preview and blocked tracks', async () => {
    const snip = hls('mp3_1_0', {
      snipped: true,
      format: { protocol: 'progressive', mime_type: 'audio/mpeg' }
    })
    const byId: Record<string, ScTrack> = {
      '1': track(1, { policy: 'SNIP', media: { transcodings: [snip] } }),
      '3': track(3, { policy: 'BLOCK', media: { transcodings: [] } })
    }
    const { provider, fetch } = setup((_c, u) => {
      const id = u.pathname.split('/').pop()!
      return byId[id] ? json(byId[id]) : json({}, 404)
    })
    for (const [id, why] of [
      ['1', 'preview'],
      ['3', 'blocked'],
      ['4', 'blocked']
    ] as const) {
      const err = await rejection<UnplayableTrackError>(provider.getStreamUrl(id))
      expect(err).toBeInstanceOf(UnplayableTrackError)
      expect(err.availability).toBe(why)
      expect(err.message).toBe(UNPLAYABLE_MESSAGES[why])
    }
    // Never resolved a snipped transcoding.
    expect(fetch.calls.some((c) => c.url.includes('/media/'))).toBe(false)
  })

  it('falls back to the Widevine stream with a license URL for DRM-only tracks', async () => {
    const ctr = hls('aac_160k', {
      format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' }
    })
    const cbc = hls('aac_160k', {
      url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:2/aac_160k/stream/cbc',
      format: { protocol: 'cbc-encrypted-hls', mime_type: 'audio/mp4' }
    })
    const { provider, fetch } = setup((c, u) => {
      if (u.pathname === '/tracks/2') return json(track(2, { media: { transcodings: [cbc, ctr] } }))
      if (c.url.startsWith(ctr.url!))
        return json({
          url: 'https://playback.media-streaming.soundcloud.cloud/x/cenc/playlist.m3u8',
          licenseAuthToken: 'tok en'
        })
      return json({}, 404)
    })
    const info = await provider.getStreamUrl('2')
    expect(info.protocol).toBe('hls')
    expect(info.drm).toEqual({
      keySystem: 'com.widevine.alpha',
      licenseUrl:
        'https://license.media-streaming.soundcloud.cloud/playback/widevine?license_token=tok%20en'
    })
    // FairPlay (cbc) is never used.
    expect(fetch.calls.some((c) => c.url.startsWith(cbc.url!))).toBe(false)
  })

  it('treats an encrypted stream without a license token as DRM-unplayable', async () => {
    const ctr = hls('aac_160k', {
      format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4' }
    })
    const { provider } = setup((c, u) => {
      if (u.pathname === '/tracks/2') return json(track(2, { media: { transcodings: [ctr] } }))
      if (c.url.startsWith(ctr.url!))
        return json({ url: 'https://playback.media-streaming.soundcloud.cloud/x.m3u8' })
      return json({}, 404)
    })
    const err = await rejection<UnplayableTrackError>(provider.getStreamUrl('2'))
    expect(err.availability).toBe('drm')
  })

  it('normalizes the waveform JSON', async () => {
    const { provider, fetch } = setup((_c, u) => {
      if (u.pathname === '/tracks/5') return json(track(5))
      if (u.hostname === 'wave.sndcdn.com')
        return json({ width: 3, height: 140, samples: [0, 70, 140] })
      return json({}, 404)
    })
    await expect(provider.getWaveform('5')).resolves.toEqual([0, 0.5, 1])
    expect(fetch.calls[1]!.headers.Authorization).toBeUndefined()
  })

  it('returns the official download only when the artist enabled it', async () => {
    const { provider } = setup((_c, u) => {
      if (u.pathname === '/tracks/5')
        return json(track(5, { downloadable: true, has_downloads_left: true }))
      if (u.pathname === '/tracks/6') return json(track(6, { downloadable: false }))
      if (u.pathname === '/tracks/5/download')
        return json({ redirectUri: 'https://cf-media.sndcdn.com/abc/Song%20Name.wav?Policy=x' })
      return json({}, 404)
    })
    await expect(provider.getOfficialDownload('5')).resolves.toEqual({
      url: 'https://cf-media.sndcdn.com/abc/Song%20Name.wav?Policy=x',
      filename: 'Song Name.wav'
    })
    await expect(provider.getOfficialDownload('6')).resolves.toBeNull()
  })

  it('reads timed comments and posts body + timestamp as query params', async () => {
    const post = vi.fn()
    const { provider } = setup((c, u) => {
      if (c.method === 'POST') {
        post(u.pathname, u.searchParams.get('body'), u.searchParams.get('timestamp'), c.body)
        return json({ id: 9, body: 'hi', timestamp: 1500, user: { id: 9, username: 'me' } })
      }
      return json({
        collection: [
          { id: 2, body: 'b', timestamp: 2000, user: { id: 1, username: 'x' } },
          { id: 1, body: 'a', timestamp: 1000, user: { id: 1, username: 'x' } },
          { id: 3, body: 'untimed', timestamp: null }
        ],
        next_href: null
      })
    })
    const comments = await provider.getComments('5')
    expect(comments.map((c) => c.id)).toEqual(['1', '2'])
    await expect(provider.postComment('5', ' hi ', 1500.4)).resolves.toMatchObject({ id: '9' })
    expect(post).toHaveBeenCalledWith('/tracks/5/comments', 'hi', '1500', undefined)
  })
})

describe('SoundCloudWebProvider playlist editing (fetch-then-PUT)', () => {
  function editHarness(
    playlist: Record<string, unknown>,
    put: () => Response = () => json({ id: 5 })
  ): { h: Harness; puts: unknown[] } {
    const puts: unknown[] = []
    const h = setup((call, u) => {
      if (u.pathname === '/playlists/5' && call.method === 'GET') return json(playlist)
      if (u.pathname === '/playlists/5' && call.method === 'PUT') {
        puts.push(JSON.parse(call.body!))
        return put()
      }
      return json({}, 404)
    })
    return { h, puts }
  }

  const stub = (id: number): ScTrack => ({ id, kind: 'track' }) as ScTrack

  it('appends to the full id list, stubs included', async () => {
    const { h, puts } = editHarness({
      id: 5,
      kind: 'playlist',
      track_count: 3,
      tracks: [track(1), stub(2), stub(1)]
    })
    await h.provider.addToPlaylist('soundcloud:5', [scTrack('3'), scTrack('2')])
    expect(puts).toEqual([{ playlist: { tracks: [1, 2, 1, 3, 2] } }])
    const put = h.fetch.calls.find((c) => c.method === 'PUT')!
    expect(put.headers.Authorization).toBe('OAuth tok')
  })

  it('removes every occurrence', async () => {
    const { h, puts } = editHarness({
      id: 5,
      kind: 'playlist',
      track_count: 4,
      tracks: [track(1), stub(2), stub(1), stub(3)]
    })
    await h.provider.removeFromPlaylist('soundcloud:5', [scTrack('1')])
    expect(puts).toEqual([{ playlist: { tracks: [2, 3] } }])
  })

  it('skips the write when nothing would change', async () => {
    const { h, puts } = editHarness({ id: 5, kind: 'playlist', track_count: 1, tracks: [stub(1)] })
    await h.provider.removeFromPlaylist('soundcloud:5', [scTrack('9')])
    expect(puts).toEqual([])
  })

  it('refuses to write when the list came back empty but track_count says otherwise', async () => {
    for (const tracks of [[], undefined]) {
      const { h, puts } = editHarness({ id: 5, kind: 'playlist', track_count: 12, tracks })
      await expect(h.provider.addToPlaylist('soundcloud:5', [scTrack('3')])).rejects.toThrow(
        /wasn't changed/
      )
      await expect(h.provider.removeFromPlaylist('soundcloud:5', [scTrack('3')])).rejects.toThrow(
        /wasn't changed/
      )
      expect(puts).toEqual([])
    }
  })

  it('adds to a genuinely empty playlist', async () => {
    const { h, puts } = editHarness({ id: 5, kind: 'playlist', track_count: 0, tracks: [] })
    await h.provider.addToPlaylist('soundcloud:5', [scTrack('3')])
    expect(puts).toEqual([{ playlist: { tracks: [3] } }])
  })

  it('validates ids before any request', async () => {
    const { h } = editHarness({ id: 5, kind: 'playlist', tracks: [] })
    await expect(h.provider.addToPlaylist('spotify:5', [scTrack('3')])).rejects.toThrow(
      /Not a SoundCloud playlist/
    )
    await expect(h.provider.addToPlaylist('soundcloud:5/x', [scTrack('3')])).rejects.toThrow(
      /Invalid SoundCloud playlist id/
    )
    const sp: Track = { ...scTrack('1'), id: 'spotify:1', provider: 'spotify' }
    await expect(h.provider.addToPlaylist('soundcloud:5', [sp])).rejects.toThrow(
      /Not a SoundCloud track/
    )
    expect(h.fetch.calls).toHaveLength(0)
  })
})

describe('SoundCloudWebProvider catalog (logged out)', () => {
  const user = {
    id: 183,
    kind: 'user',
    username: 'Forss',
    avatar_url: 'https://i1.sndcdn.com/avatars-000012778523-59quu3-large.jpg',
    permalink_url: 'https://soundcloud.com/forss',
    followers_count: 132109,
    verified: true,
    track_count: 26,
    visuals: { visuals: [{ visual_url: 'https://i1.sndcdn.com/visuals-183-original.jpg' }] }
  }
  const set = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    kind: 'playlist',
    title: `Set ${id}`,
    set_type: 'album',
    is_album: true,
    release_date: '2012-06-12T00:00:00Z',
    published_at: null,
    display_date: '2012-04-02T14:34:11Z',
    track_count: 2,
    artwork_url: null,
    permalink_url: `https://soundcloud.com/forss/sets/s${id}`,
    user: { id: 183, username: 'Forss', permalink_url: 'https://soundcloud.com/forss' },
    tracks: [],
    ...over
  })

  it('builds the artist page from public endpoints', async () => {
    const { provider, fetch } = setup(
      (_c, u) => {
        if (u.pathname === '/users/183') return json(user)
        if (u.pathname === '/users/183/toptracks')
          return json({ collection: [track(1), track(2)], next_href: null })
        if (u.pathname === '/users/183/albums') {
          if (!u.searchParams.has('offset'))
            return json({
              collection: [
                set(18, { release_date: '2003-06-02T00:00:00Z', set_type: 'ep' }),
                set(19, { set_type: '', is_album: true, release_date: null, published_at: null })
              ],
              next_href: 'https://api-v2.soundcloud.com/users/183/albums?offset=2&limit=50'
            })
          return json({ collection: [set(20)], next_href: null })
        }
        if (u.pathname === '/users/183/playlists_without_albums')
          return json({
            collection: [set(30, { set_type: '', is_album: false, title: 'Mix' })],
            next_href: null
          })
        return json({}, 404)
      },
      { loggedIn: false }
    )
    const page = await provider.getArtist('183')
    expect(page.artist).toEqual({
      id: 'soundcloud:183',
      provider: 'soundcloud',
      nativeId: '183',
      name: 'Forss',
      imageUrl: 'https://i1.sndcdn.com/avatars-000012778523-59quu3-t500x500.jpg',
      bannerUrl: 'https://i1.sndcdn.com/visuals-183-original.jpg',
      followers: 132109,
      verified: true,
      url: 'https://soundcloud.com/forss'
    })
    expect(page.trackCount).toBe(26)
    expect(page.topTracks.map((t) => t.nativeId)).toEqual(['1', '2'])
    // Newest first; 19 falls back to display_date.
    expect(page.releases.map((r) => [r.nativeId, r.type, r.releaseDate])).toEqual([
      ['20', 'album', '2012-06-12'],
      ['19', 'album', '2012-04-02'],
      ['18', 'ep', '2003-06-02']
    ])
    expect(page.releases[0]!.artists).toEqual([
      { id: 'soundcloud:183', name: 'Forss', url: 'https://soundcloud.com/forss' }
    ])
    expect(page.playlists.map((p) => [p.id, p.name, p.canEdit])).toEqual([
      ['soundcloud:30', 'Mix', false]
    ])
    expect(fetch.calls.every((c) => c.headers.Authorization === undefined)).toBe(true)
  })

  it('hydrates album stubs logged out and maps plain sets as playlists', async () => {
    const { provider, fetch } = setup(
      (_c, u) => {
        if (u.pathname === '/playlists/18')
          return json(
            set(18, {
              track_count: 3,
              tracks: [track(1), { id: 2, kind: 'track', policy: 'ALLOW' }, track(3)]
            })
          )
        if (u.pathname === '/playlists/30')
          return json(set(30, { set_type: '', is_album: false, tracks: [track(5)] }))
        if (u.pathname === '/tracks') return json([track(2, { artwork_url: 'x' })])
        return json({}, 404)
      },
      { loggedIn: false }
    )
    const page = await provider.getAlbum('18')
    expect(page.album).toMatchObject({ id: 'soundcloud:18', type: 'album', trackCount: 3 })
    expect(page.tracks.map((t) => t.nativeId)).toEqual(['1', '2', '3'])
    expect(page.copyrights).toEqual([])
    expect(fetch.calls.every((c) => c.headers.Authorization === undefined)).toBe(true)
    const pl = await provider.getAlbum('30')
    expect(pl.album.type).toBe('playlist')
    await expect(provider.getAlbum('../1')).rejects.toThrow(/Invalid SoundCloud playlist id/)
  })

  it('pages every upload with limit 200, dedupes, and stops on an empty page', async () => {
    const { provider, fetch } = setup(
      (_c, u) => {
        const off = Number(u.searchParams.get('offset') ?? 0)
        if (off === 0)
          return json({
            collection: [track(1), track(2)],
            next_href: 'https://api-v2.soundcloud.com/users/5/tracks?offset=2&limit=200'
          })
        if (off === 2)
          return json({
            collection: [track(2), track(3)],
            next_href: 'https://api-v2.soundcloud.com/users/5/tracks?offset=4&limit=200'
          })
        return json({
          collection: [],
          next_href: 'https://api-v2.soundcloud.com/users/5/tracks?offset=6&limit=200'
        })
      },
      { loggedIn: false }
    )
    const tracks = await provider.getArtistTracks('5')
    expect(tracks.map((t) => t.nativeId)).toEqual(['1', '2', '3'])
    expect(fetch.calls).toHaveLength(3)
    expect(new URL(fetch.calls[0]!.url).searchParams.get('limit')).toBe('200')
  })

  it('caps getArtistTracks at ARTIST_TRACKS_MAX and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let n = 0
    const { provider } = setup(
      () => {
        const page = Array.from({ length: 200 }, () => track(++n))
        return json({
          collection: page,
          next_href: `https://api-v2.soundcloud.com/users/5/tracks?offset=${n}`
        })
      },
      { loggedIn: false }
    )
    const tracks = await provider.getArtistTracks('5')
    expect(tracks).toHaveLength(ARTIST_TRACKS_MAX)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stopped at 2000'))
    warn.mockRestore()
  })
})

describe('SoundCloudWebProvider.searchArtists', () => {
  const user = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    kind: 'user',
    username: `user${id}`,
    avatar_url: `https://i1.sndcdn.com/avatars-${id}-large.jpg`,
    permalink_url: `https://soundcloud.com/user${id}`,
    followers_count: id * 10,
    verified: id === 1,
    ...over
  })

  it('queries search/users logged out and maps profiles in order', async () => {
    const { provider, fetch, path } = setup(
      (_c, u) => {
        if (u.pathname === '/search/users')
          return json({
            collection: [user(1), null, { kind: 'user' }, user(2), user(1)],
            next_href: null
          })
        return json({}, 404)
      },
      { loggedIn: false }
    )
    const artists = await provider.searchArtists('  forss ')
    expect(artists).toEqual([
      {
        id: 'soundcloud:1',
        provider: 'soundcloud',
        nativeId: '1',
        name: 'user1',
        imageUrl: 'https://i1.sndcdn.com/avatars-1-t500x500.jpg',
        followers: 10,
        verified: true,
        url: 'https://soundcloud.com/user1'
      },
      {
        id: 'soundcloud:2',
        provider: 'soundcloud',
        nativeId: '2',
        name: 'user2',
        imageUrl: 'https://i1.sndcdn.com/avatars-2-t500x500.jpg',
        followers: 20,
        verified: false,
        url: 'https://soundcloud.com/user2'
      }
    ])
    const calls = fetch.calls.filter((c) => path(c) === '/search/users')
    expect(calls).toHaveLength(1)
    const params = new URL(calls[0]!.url).searchParams
    expect(params.get('q')).toBe('forss')
    expect(params.get('limit')).toBe('10')
    expect(fetch.calls.every((c) => c.headers.Authorization === undefined)).toBe(true)
  })

  it('caps the result at 10', async () => {
    const { provider } = setup((_c, u) =>
      u.pathname === '/search/users'
        ? json({ collection: Array.from({ length: 15 }, (_, i) => user(i + 1)) })
        : json({}, 404)
    )
    expect(await provider.searchArtists('x')).toHaveLength(10)
  })

  it('returns [] for an empty query without a request', async () => {
    const { provider, fetch, path } = setup(() => json({}, 404))
    expect(await provider.searchArtists(' ')).toEqual([])
    expect(fetch.calls.filter((c) => path(c).startsWith('/search'))).toHaveLength(0)
  })
})

describe('SoundCloudWebProvider.searchSets', () => {
  const set = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    kind: 'playlist',
    title: `Set ${id}`,
    track_count: 5,
    artwork_url: `https://i1.sndcdn.com/artworks-${id}-large.jpg`,
    user: { id: 9, username: 'hi-c', permalink_url: 'https://soundcloud.com/hi-c' },
    permalink_url: `https://soundcloud.com/hi-c/sets/${id}`,
    set_type: '',
    is_album: false,
    ...over
  })

  it('queries search/playlists logged out, keeps playlists and albums, skips empty sets', async () => {
    const { provider, fetch, path } = setup(
      (_c, u) => {
        if (u.pathname === '/search/playlists')
          return json({
            collection: [
              set(1),
              set(2, { set_type: 'album', is_album: true, release_date: '2024-05-01T00:00:00Z' }),
              set(3, { track_count: 0 }),
              null,
              set(1)
            ],
            next_href: null
          })
        return json({}, 404)
      },
      { loggedIn: false }
    )
    const sets = await provider.searchSets(' hi-c ')
    expect(sets.map((s) => [s.id, s.type, s.name, s.trackCount])).toEqual([
      ['soundcloud:1', 'playlist', 'Set 1', 5],
      ['soundcloud:2', 'album', 'Set 2', 5]
    ])
    expect(sets[0]!.artists[0]?.name).toBe('hi-c')
    const call = fetch.calls.find((c) => path(c) === '/search/playlists')!
    expect(new URL(call.url).searchParams.get('q')).toBe('hi-c')
    expect(call.headers.Authorization).toBeUndefined()
    await expect(provider.searchSets('   ')).resolves.toEqual([])
  })
})

describe('SoundCloudWebProvider.getArtistInfo', () => {
  it('reads just users/{id}, logged out', async () => {
    const { provider, fetch } = setup(
      (_c, u) =>
        u.pathname === '/users/183'
          ? json({ id: 183, username: 'Forss', permalink_url: 'https://soundcloud.com/forss' })
          : json({}, 404),
      { loggedIn: false }
    )
    const artist = await provider.getArtistInfo('183')
    expect(artist).toMatchObject({ id: 'soundcloud:183', nativeId: '183', name: 'Forss' })
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0]!.headers.Authorization).toBeUndefined()
  })

  it('rejects non-numeric ids before any request', async () => {
    const { provider, fetch } = setup(() => json({}))
    await expect(provider.getArtistInfo('abc')).rejects.toThrow(/Invalid SoundCloud user id/)
    expect(fetch.calls).toHaveLength(0)
  })
})
