import { describe, expect, it, vi } from 'vitest'
import type { MusicProvider } from '@shared/provider'
import type { Artist, Track } from '@shared/types'
import { ARTIST_INFO_TTL_MS, createMusicRouter, type LikeChecker } from './router'

function fakeProvider(): MusicProvider & LikeChecker {
  return {
    search: vi.fn(async () => []),
    getLikes: vi.fn(async () => []),
    like: vi.fn(async () => {}),
    unlike: vi.fn(async () => {}),
    getPlaylists: vi.fn(async () => []),
    getPlaylistTracks: vi.fn(async () => []),
    isLiked: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === 'a'])))
  }
}

const track = (provider: Track['provider'], nativeId = 'a'): Track => ({
  id: `${provider}:${nativeId}`,
  provider,
  nativeId,
  title: 't',
  artists: [],
  durationMs: 0
})

describe('music router', () => {
  it('routes by provider argument, track.provider and playlist prefix', async () => {
    const spotify = fakeProvider()
    const router = createMusicRouter({ spotify })
    await router.search('spotify', 'q', 1)
    expect(spotify.search).toHaveBeenCalledWith('q', 1)
    await router.like(track('spotify'))
    expect(spotify.like).toHaveBeenCalled()
    await router.getPlaylistTracks('spotify:pl')
    expect(spotify.getPlaylistTracks).toHaveBeenCalledWith('spotify:pl')
  })

  it('throws a clear error for providers that are not connected', async () => {
    const router = createMusicRouter({})
    const msg = "Spotify isn't connected. Connect it in Settings."
    await expect(router.getLikes('spotify')).rejects.toThrow(msg)
    await expect(router.unlike(track('spotify'))).rejects.toThrow(msg)
    await expect(router.getPlaylistTracks('spotify:x')).rejects.toThrow(msg)
    await expect(router.getPlaylists('soundcloud')).rejects.toThrow(
      "SoundCloud isn't connected. Connect it in Settings."
    )
  })

  it('rejects local, app and unknown targets', async () => {
    const router = createMusicRouter({ spotify: fakeProvider() })
    await expect(router.like(track('local'))).rejects.toThrow(/Local/)
    await expect(router.getPlaylistTracks('app:1')).rejects.toThrow(/App playlists/)
    await expect(router.getPlaylistTracks('nope')).rejects.toThrow(/Invalid playlist id/)
    await expect(router.search('tidal' as never, 'q', 0)).rejects.toThrow(/Unknown/)
  })

  it('groups isLiked by provider', async () => {
    const spotify = fakeProvider()
    const soundcloud = fakeProvider()
    const router = createMusicRouter({ spotify, soundcloud })
    const res = await router.isLiked(['spotify:a', 'spotify:b', 'soundcloud:a', 'local:x', 'junk'])
    expect(res).toEqual({
      'spotify:a': true,
      'spotify:b': false,
      'soundcloud:a': true,
      'local:x': false,
      junk: false
    })
    expect(spotify.isLiked).toHaveBeenCalledWith(['a', 'b'])
    expect(soundcloud.isLiked).toHaveBeenCalledWith(['a'])
  })

  it('reports ids of unconnected providers as not liked', async () => {
    const spotify = fakeProvider()
    const router = createMusicRouter({ spotify })
    await expect(router.isLiked(['soundcloud:1', 'spotify:a'])).resolves.toEqual({
      'soundcloud:1': false,
      'spotify:a': true
    })
  })
})

describe('catalog routing', () => {
  const page = { artist: { id: 'spotify:a' } } as never
  function catalogProvider(): ReturnType<typeof fakeProvider> & {
    getArtist: ReturnType<typeof vi.fn>
    getAlbum: ReturnType<typeof vi.fn>
    getArtistTracks: ReturnType<typeof vi.fn>
  } {
    return {
      ...fakeProvider(),
      getArtist: vi.fn(async () => page),
      getAlbum: vi.fn(async () => page),
      getArtistTracks: vi.fn(async () => [])
    }
  }

  it('passes native ids to the provider named by the prefix', async () => {
    const spotify = catalogProvider()
    const soundcloud = catalogProvider()
    const router = createMusicRouter({ spotify, soundcloud })
    await expect(router.getArtist('spotify:abc')).resolves.toBe(page)
    expect(spotify.getArtist).toHaveBeenCalledWith('abc')
    await router.getAlbum('soundcloud:18')
    expect(soundcloud.getAlbum).toHaveBeenCalledWith('18')
    await router.getArtistTracks('soundcloud:183')
    expect(soundcloud.getArtistTracks).toHaveBeenCalledWith('183')
  })

  it('rejects bad, local, unknown and unconnected ids, and non-catalog providers', async () => {
    const router = createMusicRouter({ spotify: fakeProvider() })
    await expect(router.getArtist('abc')).rejects.toThrow(/Invalid artist id/)
    await expect(router.getAlbum('spotify:')).rejects.toThrow(/Invalid album id/)
    await expect(router.getArtist(42 as never)).rejects.toThrow(/Invalid artist id/)
    await expect(router.getArtist('local:x')).rejects.toThrow(/Local files/)
    await expect(router.getAlbum('tidal:1')).rejects.toThrow(/Unknown music service/)
    await expect(router.getArtistTracks('soundcloud:1')).rejects.toThrow(/isn't connected/)
    await expect(router.getArtist('spotify:a')).rejects.toThrow('Spotify has no artist pages.')
  })
})

describe('getArtistInfo', () => {
  const artist = (id: string): Artist => ({
    id,
    provider: id.startsWith('spotify') ? 'spotify' : 'soundcloud',
    nativeId: id.split(':')[1]!,
    name: 'A',
    url: 'https://x'
  })
  function infoProvider(fail = false): ReturnType<typeof fakeProvider> & {
    getArtist: ReturnType<typeof vi.fn>
    getAlbum: ReturnType<typeof vi.fn>
    getArtistTracks: ReturnType<typeof vi.fn>
    getArtistInfo: ReturnType<typeof vi.fn>
  } {
    return {
      ...fakeProvider(),
      getArtist: vi.fn(async () => ({}) as never),
      getAlbum: vi.fn(async () => ({}) as never),
      getArtistTracks: vi.fn(async () => []),
      getArtistInfo: vi.fn(async (nativeId: string) => {
        if (fail) throw new Error('down')
        return artist(`spotify:${nativeId}`)
      })
    }
  }

  it('asks the provider once per id and reuses the answer for 10 minutes', async () => {
    let clock = 0
    const spotify = infoProvider()
    const router = createMusicRouter({ spotify }, { now: () => clock })
    const [a, b] = await Promise.all([
      router.getArtistInfo('spotify:abc'),
      router.getArtistInfo('spotify:abc')
    ])
    expect(a).toEqual(artist('spotify:abc'))
    expect(b).toBe(a)
    expect(spotify.getArtistInfo).toHaveBeenCalledTimes(1)
    expect(spotify.getArtistInfo).toHaveBeenCalledWith('abc')
    expect(spotify.getArtist).not.toHaveBeenCalled()
    clock = ARTIST_INFO_TTL_MS - 1
    await router.getArtistInfo('spotify:abc')
    expect(spotify.getArtistInfo).toHaveBeenCalledTimes(1)
    await router.getArtistInfo('spotify:other')
    expect(spotify.getArtistInfo).toHaveBeenCalledTimes(2)
    clock = ARTIST_INFO_TTL_MS
    await router.getArtistInfo('spotify:abc')
    expect(spotify.getArtistInfo).toHaveBeenCalledTimes(3)
    expect(ARTIST_INFO_TTL_MS).toBe(10 * 60_000)
  })

  it('does not cache failures, and validates ids like getArtist', async () => {
    const spotify = infoProvider(true)
    const router = createMusicRouter({ spotify })
    await expect(router.getArtistInfo('spotify:abc')).rejects.toThrow('down')
    await expect(router.getArtistInfo('spotify:abc')).rejects.toThrow('down')
    expect(spotify.getArtistInfo).toHaveBeenCalledTimes(2)
    await expect(router.getArtistInfo('abc')).rejects.toThrow(/Invalid artist id/)
    await expect(router.getArtistInfo('local:x')).rejects.toThrow(/Local files/)
    await expect(router.getArtistInfo('soundcloud:1')).rejects.toThrow(/isn't connected/)
    const plain = createMusicRouter({ spotify: fakeProvider() })
    await expect(plain.getArtistInfo('spotify:a')).rejects.toThrow('Spotify has no artist pages.')
  })
})

describe('findOn', () => {
  const source = (over: Partial<Track> = {}): Track => ({
    id: 'soundcloud:1',
    provider: 'soundcloud',
    nativeId: '1',
    title: 'Forss - Flickermood',
    artists: ['Forss'],
    durationMs: 200_000,
    ...over
  })
  const sp = (nativeId: string, title: string, over: Partial<Track> = {}): Track => ({
    id: `spotify:${nativeId}`,
    provider: 'spotify',
    nativeId,
    title,
    artists: ['Forss'],
    durationMs: 200_000,
    ...over
  })

  it('asks Spotify by ISRC, then by artist and title, ISRC matches first', async () => {
    const spotify = fakeProvider()
    vi.mocked(spotify.search).mockImplementation(async (q: string) =>
      q.startsWith('isrc:')
        ? [sp('i', 'Flickermood - 2004 Mix', { isrc: 'SEABC0400001', artists: ['Other'] })]
        : [sp('x', 'Unrelated'), sp('t', 'Flickermood'), sp('i', 'Flickermood')]
    )
    const router = createMusicRouter({ spotify })
    const res = await router.findOn(source({ isrc: 'se-abc-04-00001' }), 'spotify')
    expect(spotify.search).toHaveBeenCalledWith('isrc:SEABC0400001', 0)
    expect(spotify.search).toHaveBeenCalledWith('Forss Flickermood', 0)
    expect(res).toEqual({
      service: 'spotify',
      matches: [
        { track: expect.objectContaining({ id: 'spotify:i' }), reason: 'isrc' },
        { track: expect.objectContaining({ id: 'spotify:t' }), reason: 'title-artist' }
      ]
    })
  })

  it('searches SoundCloud by title only and marks results carrying the ISRC', async () => {
    const soundcloud = fakeProvider()
    const sc = (nativeId: string, isrc?: string): Track => ({
      ...source({ id: `soundcloud:${nativeId}`, nativeId }),
      ...(isrc ? { isrc } : {})
    })
    vi.mocked(soundcloud.search).mockResolvedValue([sc('2'), sc('3', 'SEABC0400001')])
    const router = createMusicRouter({ soundcloud })
    const local: Track = {
      id: 'local:a',
      provider: 'local',
      nativeId: 'a',
      title: 'Flickermood',
      artists: ['Forss'],
      durationMs: 0,
      isrc: 'SEABC0400001'
    }
    const res = await router.findOn(local, 'soundcloud')
    expect(soundcloud.search).toHaveBeenCalledTimes(1)
    expect(soundcloud.search).toHaveBeenCalledWith('Forss Flickermood', 0)
    expect(res.matches.map((m) => [m.track.id, m.reason])).toEqual([
      ['soundcloud:3', 'isrc'],
      ['soundcloud:2', 'title-artist']
    ])
  })

  it('skips the ISRC search for a malformed ISRC and searches nothing without an artist', async () => {
    const spotify = fakeProvider()
    const router = createMusicRouter({ spotify })
    await router.findOn(source({ isrc: 'x artist:y' }), 'spotify')
    expect(spotify.search).toHaveBeenCalledTimes(1)
    expect(spotify.search).toHaveBeenCalledWith('Forss Flickermood', 0)
    vi.mocked(spotify.search).mockClear()
    await expect(router.findOn(source({ artists: [] }), 'spotify')).resolves.toEqual({
      service: 'spotify',
      matches: []
    })
    expect(spotify.search).not.toHaveBeenCalled()
  })

  it('rejects the same service, unconnected services and malformed input', async () => {
    const router = createMusicRouter({ soundcloud: fakeProvider() })
    await expect(router.findOn(source(), 'soundcloud')).rejects.toThrow(
      'This track is already on SoundCloud.'
    )
    await expect(router.findOn(source(), 'spotify')).rejects.toThrow(
      "Spotify isn't connected. Connect it in Settings."
    )
    await expect(router.findOn(source(), 'local' as never)).rejects.toThrow(/Unknown/)
    await expect(router.findOn(null as never, 'spotify')).rejects.toThrow('Not a valid track.')
    await expect(router.findOn(source({ artists: 'Forss' as never }), 'spotify')).rejects.toThrow(
      'Not a valid track.'
    )
    await expect(router.findOn(source({ provider: 'tidal' as never }), 'spotify')).rejects.toThrow(
      'Not a valid track.'
    )
  })
})

describe('searchArtists routing', () => {
  const found = [{ id: 'soundcloud:1', provider: 'soundcloud', nativeId: '1', name: 'A' }]
  function searcher(): ReturnType<typeof fakeProvider> & {
    searchArtists: ReturnType<typeof vi.fn>
  } {
    return { ...fakeProvider(), searchArtists: vi.fn(async () => found) }
  }

  it('passes the query to the right provider', async () => {
    const spotify = searcher()
    const soundcloud = searcher()
    const router = createMusicRouter({ spotify, soundcloud })
    await expect(router.searchArtists('soundcloud', 'forss')).resolves.toBe(found)
    expect(soundcloud.searchArtists).toHaveBeenCalledWith('forss')
    expect(spotify.searchArtists).not.toHaveBeenCalled()
  })

  it('rejects unknown, local and unconnected providers', async () => {
    const router = createMusicRouter({ soundcloud: searcher() })
    await expect(router.searchArtists('nope' as never, 'x')).rejects.toThrow(
      'Unknown music service: nope'
    )
    await expect(router.searchArtists('local' as never, 'x')).rejects.toThrow(/Local files/)
    await expect(router.searchArtists('spotify', 'x')).rejects.toThrow(
      "Spotify isn't connected. Connect it in Settings."
    )
  })

  it('rejects a provider without artist search and a non-string query', async () => {
    const router = createMusicRouter({ spotify: fakeProvider(), soundcloud: searcher() })
    await expect(router.searchArtists('spotify', 'x')).rejects.toThrow(
      "Spotify can't search for artists."
    )
    await expect(router.searchArtists('soundcloud', 42 as never)).rejects.toThrow(
      'No search query given.'
    )
  })

  it('answers a blank query with [] without calling the provider', async () => {
    const soundcloud = searcher()
    const router = createMusicRouter({ soundcloud })
    await expect(router.searchArtists('soundcloud', '  ')).resolves.toEqual([])
    expect(soundcloud.searchArtists).not.toHaveBeenCalled()
  })
})
