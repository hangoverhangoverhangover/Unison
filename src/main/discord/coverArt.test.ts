import { describe, expect, it, vi } from 'vitest'
import type { PresenceUpdate } from '@shared/discord'
import type { Track } from '@shared/types'
import { openDb } from '../db'
import {
  cacheKey,
  cleanTitle,
  createCoverArtLookup,
  MISS_TTL_MS,
  pickTrackArt,
  type ArtFallback,
  rankReleaseGroups,
  searchUrl,
  type CoverArtLookup
} from './coverArt'
import { withLocalArt } from './localArt'

const rec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  score: 100,
  title: 'Creep',
  'artist-credit': [{ name: 'Radiohead' }],
  releases: [
    {
      title: 'Pablo Honey',
      status: 'Official',
      'release-group': { id: 'rg-album', 'primary-type': 'Album' }
    }
  ],
  ...over
})

describe('cleanTitle / cacheKey', () => {
  it('strips featuring and video suffixes', () => {
    expect(cleanTitle('Song (feat. X) [Official Video]')).toBe('Song')
    expect(cleanTitle('Song - Remastered 2011')).toBe('Song')
    expect(cleanTitle('Song ft. Someone')).toBe('Song')
    expect(cleanTitle('Love (Live) ')).toBe('Love (Live)')
  })
  it('needs an artist and a title', () => {
    expect(cacheKey({ title: 'Créep!', artists: ['Radiohead'] })).toBe('radiohead|creep')
    expect(cacheKey({ title: 'x', artists: [] })).toBeNull()
  })
  it('builds a filtered Lucene query', () => {
    const q = new URL(searchUrl({ title: 'Say "Hi"', artists: ['A'] })).searchParams.get('query')
    expect(q).toBe(
      'recording:"Say \\"Hi\\"" AND artist:"A" AND status:official AND NOT secondarytype:live AND NOT secondarytype:compilation'
    )
  })
})

describe('rankReleaseGroups', () => {
  const q = { title: 'Creep', artists: ['Radiohead'] }
  it('prefers studio recordings on albums and skips other artists or low scores', () => {
    const groups = rankReleaseGroups(q, [
      rec({
        disambiguation: 'live',
        releases: [
          {
            title: 'Live',
            status: 'Official',
            'release-group': { id: 'rg-live', 'primary-type': 'Album' }
          }
        ]
      }),
      rec(),
      rec({
        'artist-credit': [{ name: 'Someone Else' }],
        releases: [{ status: 'Official', 'release-group': { id: 'rg-other' } }]
      }),
      rec({ score: 50, releases: [{ status: 'Official', 'release-group': { id: 'rg-low' } }] }),
      rec({
        releases: [
          {
            status: 'Official',
            'release-group': {
              id: 'rg-comp',
              'primary-type': 'Album',
              'secondary-types': ['Compilation']
            }
          },
          { status: 'Bootleg', 'release-group': { id: 'rg-boot', 'primary-type': 'Album' } }
        ]
      })
    ])
    expect(groups).toEqual(['rg-album', 'rg-live'])
  })
  it('puts the matching album first', () => {
    const groups = rankReleaseGroups({ ...q, album: 'The Bends' }, [
      rec(),
      rec({
        releases: [
          {
            title: 'The Bends',
            status: 'Official',
            'release-group': { id: 'rg-bends', 'primary-type': 'Single' }
          }
        ]
      })
    ])
    expect(groups[0]).toBe('rg-bends')
  })
})

function setup(
  responses: ((url: string, init?: RequestInit) => Response)[],
  fallbacks: ArtFallback[] = []
): {
  lookup: CoverArtLookup
  fetch: ReturnType<typeof vi.fn>
  advance: (ms: number) => number
} {
  const db = openDb(':memory:')
  let t = 1_000_000
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const next = responses.shift()
    if (!next) throw new Error(`unexpected fetch ${url}`)
    return next(url, init)
  })
  const lookup = createCoverArtLookup({
    db,
    userAgent: 'Test/1',
    fallbacks,
    fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms
    }
  })
  return { lookup, fetch, advance: (ms: number) => (t += ms) }
}

const search = (recordings: unknown[]) => () => Response.json({ recordings })
const redirect = (location: string) => () =>
  new Response(null, { status: 307, headers: { location } })
const notFound = (): Response => new Response(null, { status: 404 })

describe('createCoverArtLookup', () => {
  const q = { title: 'Creep', artists: ['Radiohead'] }

  it('returns the archive.org redirect target and caches it', async () => {
    const { lookup, fetch } = setup([
      search([rec()]),
      redirect('http://archive.org/download/mbid-1/front_thumb500.jpg')
    ])
    expect(lookup.cached(q)).toBeUndefined()
    await expect(lookup.find(q)).resolves.toBe(
      'https://archive.org/download/mbid-1/front_thumb500.jpg'
    )
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://coverartarchive.org/release-group/rg-album/front-500'
    )
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ 'User-Agent': 'Test/1' })
    expect(lookup.cached(q)).toBe('https://archive.org/download/mbid-1/front_thumb500.jpg')
    await lookup.find(q)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('tries the next release group when one has no art, and caches misses for a while', async () => {
    const two = rec({
      releases: [
        { status: 'Official', 'release-group': { id: 'a', 'primary-type': 'Album' } },
        { status: 'Official', 'release-group': { id: 'b', 'primary-type': 'Single' } }
      ]
    })
    const { lookup, advance } = setup([search([two]), notFound, notFound, search([])])
    await expect(lookup.find(q)).resolves.toBeNull()
    expect(lookup.cached(q)).toBeNull()
    advance(MISS_TTL_MS)
    expect(lookup.cached(q)).toBeUndefined()
    await expect(lookup.find(q)).resolves.toBeNull()
  })

  it("doesn't cache errors, dedupes concurrent lookups and spaces MusicBrainz calls", async () => {
    const { lookup, fetch } = setup([
      () => new Response(null, { status: 503 }),
      search([]),
      search([])
    ])
    const [a, b] = await Promise.all([lookup.find(q), lookup.find(q)])
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(lookup.cached(q)).toBeUndefined()
    await lookup.find(q)
    await lookup.find({ title: 'Other', artists: ['X'] })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('withLocalArt', () => {
  const local: PresenceUpdate = {
    state: 'playing',
    track: {
      title: 'Creep',
      artists: ['Radiohead'],
      provider: 'local',
      artworkUrl: 'media://art/x'
    },
    startedAtMs: 0,
    durationMs: 1000
  }
  const art = (u: PresenceUpdate): string | undefined =>
    u.state === 'stopped' ? undefined : u.track.artworkUrl

  function fake(
    result: string | null,
    cached?: string | null
  ): CoverArtLookup & { resolve(): Promise<void> } {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    return {
      cached: () => cached,
      find: async () => {
        await gate
        return result
      },
      resolve: async () => {
        release()
        await gate
        await Promise.resolve()
      }
    }
  }

  it('sends at once, then again with the art', async () => {
    const lookup = fake('https://a/b.jpg')
    const sent: PresenceUpdate[] = []
    const send = withLocalArt(lookup, (u) => sent.push(u))
    send(local)
    await lookup.resolve()
    expect(sent.map(art)).toEqual(['media://art/x', 'https://a/b.jpg'])
  })

  it('drops a late result once something else is showing', async () => {
    const lookup = fake('https://a/b.jpg')
    const sent: PresenceUpdate[] = []
    const send = withLocalArt(lookup, (u) => sent.push(u))
    send(local)
    send({ state: 'stopped' })
    await lookup.resolve()
    expect(sent).toHaveLength(2)
  })

  it('applies a late result to a seek of the same track', async () => {
    const lookup = fake('https://a/b.jpg')
    const sent: PresenceUpdate[] = []
    const send = withLocalArt(lookup, (u) => sent.push(u))
    send(local)
    send({ ...local, startedAtMs: 5000 })
    await lookup.resolve()
    expect(sent.map(art)).toEqual(['media://art/x', 'media://art/x', 'https://a/b.jpg'])
    expect(sent[2]).toMatchObject({ startedAtMs: 5000 })
  })

  it('uses cached art directly and leaves other providers alone', () => {
    const sent: PresenceUpdate[] = []
    withLocalArt(fake(null, 'https://c/d.jpg'), (u) => sent.push(u))(local)
    const sc: PresenceUpdate = { ...local, track: { ...local.track, provider: 'soundcloud' } }
    withLocalArt(fake('https://x'), (u) => sent.push(u))(sc)
    expect(sent.map(art)).toEqual(['https://c/d.jpg', 'media://art/x'])
  })
})

const svc = (title: string, artists: string[], artworkUrl?: string): Track => ({
  id: `soundcloud:${title}`,
  provider: 'soundcloud',
  nativeId: title,
  title,
  artists,
  durationMs: 1,
  ...(artworkUrl ? { artworkUrl } : {})
})

describe('pickTrackArt', () => {
  const q = { title: 'self inflicted (prod. x)', artists: ['wifiskeleton'] }
  it('matches "Artist - Title" uploads and credited artists', () => {
    expect(
      pickTrackArt(q, [
        svc('self inflicted', ['someone else'], 'https://i1.sndcdn.com/wrong.jpg'),
        svc('wifiskeleton - self inflicted', ['uploader'], 'https://i1.sndcdn.com/a.jpg')
      ])
    ).toBe('https://i1.sndcdn.com/a.jpg')
    expect(pickTrackArt(q, [svc('Self Inflicted', ['wifiskeleton'], 'https://i.scdn.co/b')])).toBe(
      'https://i.scdn.co/b'
    )
  })
  it('skips other songs, missing art and empty credits', () => {
    expect(
      pickTrackArt(q, [
        svc('another song', ['wifiskeleton'], 'https://x/1'),
        svc('self inflicted', ['wifiskeleton']),
        svc('self inflicted', [''], 'https://x/2')
      ])
    ).toBeNull()
  })
})

describe('service fallbacks', () => {
  const q = { title: 'Song', artists: ['Artist'] }
  it('tries services in order after a MusicBrainz miss and caches the hit', async () => {
    const spotify = vi.fn(async () => [] as Track[])
    const soundcloud = vi.fn(async () => [svc('Song', ['Artist'], 'https://i1.sndcdn.com/s.jpg')])
    const { lookup } = setup(
      [search([])],
      [
        { name: 'Spotify', search: spotify },
        { name: 'SoundCloud', search: soundcloud }
      ]
    )
    await expect(lookup.find(q)).resolves.toBe('https://i1.sndcdn.com/s.jpg')
    expect(spotify).toHaveBeenCalledWith('Artist Song')
    expect(lookup.cached(q)).toBe('https://i1.sndcdn.com/s.jpg')
  })
  it('still uses a service when MusicBrainz errors, and caches no miss after an error', async () => {
    const failing = vi.fn(async (): Promise<Track[]> => {
      throw new Error('offline')
    })
    const { lookup } = setup(
      [() => new Response(null, { status: 503 })],
      [{ name: 'SoundCloud', search: failing }]
    )
    await expect(lookup.find(q)).resolves.toBeNull()
    expect(lookup.cached(q)).toBeUndefined()
  })
})
