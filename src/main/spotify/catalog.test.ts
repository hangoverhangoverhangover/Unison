import { describe, expect, it } from 'vitest'
import { SpotifyApi } from './api'
import {
  albumType,
  mapAlbum,
  mapArtist,
  mapCopyrights,
  mapTrack,
  type SpArtistRef,
  type SpTrack
} from './mapping'
import { ARTIST_ALBUMS_LIMIT, SpotifyProvider } from './provider'
import { json, scriptedFetch, type Call } from './testing'

function setup(handler: (url: URL) => Response): {
  provider: SpotifyProvider
  calls: Call[]
} {
  const fetch = scriptedFetch((call) => handler(new URL(call.url)))
  const api = new SpotifyApi(
    { getAccessToken: async () => 'at', refresh: async () => 'at' },
    { fetch, sleep: async () => {} }
  )
  return { provider: new SpotifyProvider({ api, getUserId: async () => 'me' }), calls: fetch.calls }
}

const art = (id: string, name = `Artist ${id}`): SpArtistRef => ({
  id,
  name,
  external_urls: { spotify: `https://open.spotify.com/artist/${id}` }
})

const albumRaw = (
  id: string,
  date: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id,
  name: `Album ${id}`,
  album_type: 'album',
  total_tracks: 10,
  release_date: date,
  images: [{ url: `img-${id}`, width: 640, height: 640 }],
  artists: [art('ar1')],
  ...extra
})

const simpleTrack = (id: string, n: number, extra: Partial<SpTrack> = {}): SpTrack => ({
  id,
  type: 'track',
  name: `Song ${id}`,
  duration_ms: 1000,
  track_number: n,
  disc_number: 1,
  artists: [art('ar1')],
  ...extra
})

describe('spotify catalog mapping', () => {
  it('maps artist and album refs and the track url', () => {
    const t = mapTrack({
      id: 't1',
      type: 'track',
      name: 'S',
      duration_ms: 1,
      artists: [art('a1', 'One'), { id: 'a2', name: 'Two' }],
      album: { id: 'al1', name: 'Alb', external_urls: { spotify: 'https://x/al1' } },
      external_urls: { spotify: 'https://open.spotify.com/track/t1?si=1' }
    })
    expect(t?.artists).toEqual(['One', 'Two'])
    expect(t?.artistRefs).toEqual([
      { id: 'spotify:a1', name: 'One', url: 'https://open.spotify.com/artist/a1' },
      { id: 'spotify:a2', name: 'Two', url: 'https://open.spotify.com/artist/a2' }
    ])
    expect(t?.albumRef).toEqual({ id: 'spotify:al1', name: 'Alb', url: 'https://x/al1' })
    expect(t?.url).toBe('https://open.spotify.com/track/t1?si=1')
  })

  it('infers EPs from singles with 4+ tracks', () => {
    expect(albumType({ album_type: 'single', total_tracks: 1 })).toBe('single')
    expect(albumType({ album_type: 'single', total_tracks: 3 })).toBe('single')
    expect(albumType({ album_type: 'single', total_tracks: 4 })).toBe('ep')
    expect(albumType({ album_type: 'album', total_tracks: 4 })).toBe('album')
    expect(albumType({ album_type: 'compilation' })).toBe('compilation')
  })

  it('maps albums, artists and copyrights', () => {
    expect(mapAlbum(albumRaw('x', '2026-03-27'))).toEqual({
      id: 'spotify:x',
      provider: 'spotify',
      nativeId: 'x',
      name: 'Album x',
      type: 'album',
      artists: [
        { id: 'spotify:ar1', name: 'Artist ar1', url: 'https://open.spotify.com/artist/ar1' }
      ],
      artworkUrl: 'img-x',
      releaseDate: '2026-03-27',
      trackCount: 10,
      url: 'https://open.spotify.com/album/x'
    })
    expect(mapArtist({ id: 'a', name: 'A', images: [{ url: 'i', width: 320 }] })).toEqual({
      id: 'spotify:a',
      provider: 'spotify',
      nativeId: 'a',
      name: 'A',
      imageUrl: 'i',
      url: 'https://open.spotify.com/artist/a'
    })
    expect(
      mapCopyrights([
        { text: '2026 Label', type: 'C' },
        { text: '℗ 2026 Label', type: 'P' },
        { text: '2025 Other', type: 'P' },
        { text: '', type: 'C' }
      ])
    ).toEqual(['© 2026 Label', '℗ 2026 Label', '℗ 2025 Other'])
  })
})

describe('SpotifyProvider catalog', () => {
  it('pages artist albums 10 at a time, newest first, and finds top tracks via search', async () => {
    const all = Array.from({ length: 23 }, (_, i) =>
      albumRaw(`al${i}`, `20${String(i).padStart(2, '0')}-01-01`)
    )
    const { provider, calls } = setup((url) => {
      if (url.pathname === '/v1/artists/ar1') return json({ ...art('ar1', 'Forss'), images: [] })
      if (url.pathname === '/v1/artists/ar1/albums') {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const limit = Number(url.searchParams.get('limit'))
        expect(limit).toBe(ARTIST_ALBUMS_LIMIT)
        const next =
          offset + limit < all.length
            ? `https://api.spotify.com/v1/artists/ar1/albums?offset=${offset + limit}&limit=${limit}`
            : null
        return json({ items: all.slice(offset, offset + limit), next, total: all.length })
      }
      if (url.pathname === '/v1/search') {
        expect(url.searchParams.get('q')).toBe('artist:"Forss"')
        return json({
          tracks: {
            items: [
              simpleTrack('s1', 1),
              simpleTrack('s2', 1, { artists: [art('other')] }),
              simpleTrack('s3', 1, { artists: [art('other'), art('ar1')] })
            ]
          }
        })
      }
      throw new Error(`unexpected ${url.toString()}`)
    })
    const page = await provider.getArtist('ar1')
    expect(page.artist.name).toBe('Forss')
    expect(page.artist.followers).toBeUndefined()
    expect(page.releases).toHaveLength(23)
    expect(page.releases[0]!.nativeId).toBe('al22')
    expect(page.releases.at(-1)!.nativeId).toBe('al0')
    expect(page.topTracks.map((t) => t.nativeId)).toEqual(['s1', 's3'])
    expect(page.playlists).toEqual([])
    const albumCalls = calls.filter((c) => c.url.includes('/albums'))
    expect(albumCalls).toHaveLength(3)
    expect(new URL(albumCalls[0]!.url).searchParams.get('include_groups')).toBe(
      'album,single,compilation'
    )
  })

  it('reads an album with more than 50 tracks, filling album fields', async () => {
    const tracks = Array.from({ length: 60 }, (_, i) => simpleTrack(`t${i}`, i + 1))
    const { provider } = setup((url) => {
      if (url.pathname === '/v1/albums/al1')
        return json({
          ...albumRaw('al1', '2026'),
          total_tracks: 60,
          copyrights: [{ text: '2026 L', type: 'C' }],
          tracks: {
            items: tracks.slice(0, 50),
            next: 'https://api.spotify.com/v1/albums/al1/tracks?offset=50&limit=50',
            total: 60
          }
        })
      if (url.pathname === '/v1/albums/al1/tracks') {
        expect(url.searchParams.get('offset')).toBe('50')
        return json({ items: tracks.slice(50), next: null, total: 60 })
      }
      throw new Error(`unexpected ${url.toString()}`)
    })
    const page = await provider.getAlbum('al1')
    expect(page.album.trackCount).toBe(60)
    expect(page.tracks).toHaveLength(60)
    expect(page.tracks[59]).toMatchObject({
      nativeId: 't59',
      album: 'Album al1',
      artworkUrl: 'img-al1',
      albumRef: {
        id: 'spotify:al1',
        name: 'Album al1',
        url: 'https://open.spotify.com/album/al1'
      }
    })
    expect(page.copyrights).toEqual(['© 2026 L'])
  })

  it('collects every track on albums and singles, newest first, deduped', async () => {
    const { provider, calls } = setup((url) => {
      if (url.pathname === '/v1/artists/ar1/albums')
        return json({
          items: [albumRaw('old', '2020'), albumRaw('new', '2026', { album_type: 'single' })],
          next: null,
          total: 2
        })
      if (url.pathname === '/v1/albums/old/tracks')
        return json({ items: [simpleTrack('b', 2), simpleTrack('a', 1)], next: null })
      if (url.pathname === '/v1/albums/new/tracks')
        return json({ items: [simpleTrack('n', 1), simpleTrack('a', 2)], next: null })
      throw new Error(`unexpected ${url.toString()}`)
    })
    const tracks = await provider.getArtistTracks('ar1')
    expect(tracks.map((t) => t.nativeId)).toEqual(['n', 'a', 'b'])
    expect(tracks[0]!.album).toBe('Album new')
    expect(tracks[0]!.artworkUrl).toBe('img-new')
    expect(new URL(calls[0]!.url).searchParams.get('include_groups')).toBe('album,single')
  })

  it('validates ids before any request', async () => {
    const { provider, calls } = setup(() => json({}))
    await expect(provider.getArtist('../x')).rejects.toThrow(/Invalid Spotify artist id/)
    await expect(provider.getAlbum('a b')).rejects.toThrow(/Invalid Spotify album id/)
    expect(calls).toHaveLength(0)
  })
})

describe('SpotifyProvider.searchArtists', () => {
  it('searches type=artist with limit 10 and maps artists in order', async () => {
    const { provider, calls } = setup((url) => {
      if (url.pathname === '/v1/search')
        return json({
          artists: {
            items: [
              {
                ...art('ar1', 'Forss'),
                images: [{ url: 'big', width: 640, height: 640 }],
                followers: { total: 5 }
              },
              null,
              { name: 'no id' },
              { id: 'ar2', name: 'Other' }
            ]
          }
        })
      throw new Error(`unexpected ${url.toString()}`)
    })
    const artists = await provider.searchArtists('  forss ')
    expect(artists).toEqual([
      {
        id: 'spotify:ar1',
        provider: 'spotify',
        nativeId: 'ar1',
        name: 'Forss',
        url: 'https://open.spotify.com/artist/ar1',
        imageUrl: 'big'
      },
      {
        id: 'spotify:ar2',
        provider: 'spotify',
        nativeId: 'ar2',
        name: 'Other',
        url: 'https://open.spotify.com/artist/ar2'
      }
    ])
    expect(calls).toHaveLength(1)
    const params = new URL(calls[0]!.url).searchParams
    expect(params.get('q')).toBe('forss')
    expect(params.get('type')).toBe('artist')
    expect(params.get('limit')).toBe('10')
    expect(params.get('offset')).toBeNull()
  })

  it('returns [] for an empty query without a request', async () => {
    const { provider, calls } = setup(() => json({}))
    expect(await provider.searchArtists('   ')).toEqual([])
    expect(await provider.searchArtists('')).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('copes with a response without artists', async () => {
    const { provider } = setup(() => json({}))
    expect(await provider.searchArtists('x')).toEqual([])
  })
})

describe('SpotifyProvider.getArtistInfo', () => {
  it('reads just the artist in one request', async () => {
    const { provider, calls } = setup((u) =>
      u.pathname === '/v1/artists/abc'
        ? json({ ...art('abc', 'Forss'), images: [{ url: 'img', width: 640, height: 640 }] })
        : json({}, 404)
    )
    await expect(provider.getArtistInfo('abc')).resolves.toEqual({
      id: 'spotify:abc',
      provider: 'spotify',
      nativeId: 'abc',
      name: 'Forss',
      url: 'https://open.spotify.com/artist/abc',
      imageUrl: 'img'
    })
    expect(calls).toHaveLength(1)
  })

  it('rejects bad ids before any request', async () => {
    const { provider, calls } = setup(() => json({}))
    await expect(provider.getArtistInfo('../x')).rejects.toThrow(/Invalid Spotify artist id/)
    expect(calls).toHaveLength(0)
  })
})
