import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { scrobbleAfterMs } from '@shared/lastfm'
import {
  MAX_QUEUE,
  MAX_AGE_MS,
  apiSig,
  batchParams,
  classifyError,
  enqueue,
  parseArtistInfo,
  shouldScrobble,
  toQueued,
  type QueuedScrobble
} from './core'

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex')

const track = (provider: Track['provider'], extra: Partial<Track> = {}): Track =>
  ({
    id: `${provider}:1`,
    provider,
    nativeId: '1',
    title: 'Glasshouse',
    artists: ['Neon Harbor', 'Guest'],
    album: 'Afterglow',
    durationMs: 200_000,
    ...extra
  }) as Track

describe('apiSig', () => {
  it('sorts params by name, concatenates name+value, appends the secret, md5s (UTF-8)', () => {
    const sig = apiSig({ method: 'auth.getSession', api_key: 'k', token: 'tök' }, 'secret')
    expect(sig).toBe(md5('api_keykmethodauth.getSessiontokentöksecret'))
  })

  it('leaves out format, callback and api_sig', () => {
    const a = apiSig({ method: 'm', api_key: 'k', format: 'json', callback: 'cb' }, 's')
    expect(a).toBe(md5('api_keykmethodms'))
  })

  it('sorts array names as strings (artist[10] before artist[1]... after artist[0])', () => {
    const sig = apiSig({ 'artist[1]': 'b', 'artist[10]': 'c', 'artist[0]': 'a' }, 's')
    expect(sig).toBe(md5('artist[0]aartist[10]cartist[1]bs'))
  })
})

describe('scrobble rule', () => {
  it('never for 30 s or shorter; otherwise half the track, at most 4 minutes', () => {
    expect(scrobbleAfterMs(30_000)).toBeNull()
    expect(scrobbleAfterMs(0)).toBeNull()
    expect(scrobbleAfterMs(100_000)).toBe(50_000)
    expect(scrobbleAfterMs(600_000)).toBe(240_000)
  })

  it('scrobbles SoundCloud and local files; Spotify only when turned on', () => {
    expect(shouldScrobble(track('soundcloud'), false)).toBe(true)
    expect(shouldScrobble(track('local'), false)).toBe(true)
    expect(shouldScrobble(track('spotify'), false)).toBe(false)
    expect(shouldScrobble(track('spotify'), true)).toBe(true)
  })

  it('needs an artist and a title', () => {
    expect(shouldScrobble(track('local', { artists: [] }), false)).toBe(false)
    expect(shouldScrobble(track('local', { title: ' ' }), false)).toBe(false)
  })
})

describe('queue', () => {
  const q = (n: number, at: number): QueuedScrobble => ({
    artist: `A${n}`,
    track: `T${n}`,
    timestamp: Math.floor(at / 1000)
  })

  it('keeps the newest MAX_QUEUE and drops ones older than Last.fm accepts', () => {
    const now = 2_000_000_000_000
    const old = q(0, now - MAX_AGE_MS - 1000)
    const many = Array.from({ length: MAX_QUEUE + 5 }, (_, i) => q(i + 1, now - 1000))
    const out = enqueue([old], many, now)
    expect(out).toHaveLength(MAX_QUEUE)
    expect(out[0]!.artist).toBe('A6')
    expect(out.some((s) => s.artist === 'A0')).toBe(false)
  })

  it('builds indexed batch params, at most 50, with optional fields only when set', () => {
    const items: QueuedScrobble[] = [
      { artist: 'A', track: 'T', timestamp: 100, album: 'Al', durationS: 200 },
      { artist: 'B', track: 'U', timestamp: 200 }
    ]
    expect(batchParams(items)).toEqual({
      'artist[0]': 'A',
      'track[0]': 'T',
      'timestamp[0]': '100',
      'album[0]': 'Al',
      'duration[0]': '200',
      'artist[1]': 'B',
      'track[1]': 'U',
      'timestamp[1]': '200'
    })
  })
})

describe('toQueued (QoL 4)', () => {
  it('sends the main artist, and strips archive labels from SoundCloud titles', () => {
    expect(toQueued(track('spotify'), 0).artist).toBe('Neon Harbor')
    const sc = track('soundcloud', { title: 'Sumo (unreleased) [CDQ]', artists: ['Hi C X DOMD'] })
    expect(toQueued(sc, 0)).toMatchObject({ artist: 'Hi C X DOMD', track: 'Sumo' })
    expect(toQueued(track('spotify', { title: 'Sumo (unreleased)' }), 0).track).toBe(
      'Sumo (unreleased)'
    )
  })

  it('sends every artist from your own fix as one string', () => {
    const fixed = track('soundcloud', { artists: ['Hi-C', 'DOMD'], titleGuess: 'user' })
    expect(toQueued(fixed, 0).artist).toBe('Hi-C, DOMD')
  })
})

describe('classifyError', () => {
  it('retries when Last.fm is down or busy, re-auths on a bad session, drops the rest', () => {
    expect(classifyError(11)).toBe('retry')
    expect(classifyError(16)).toBe('retry')
    expect(classifyError(29)).toBe('retry')
    expect(classifyError(9)).toBe('reauth')
    expect(classifyError(13)).toBe('drop')
    expect(classifyError(6)).toBe('drop')
  })
})

describe('artist info (QoL 4)', () => {
  it('reads artist.getInfo into plain text', () => {
    const info = parseArtistInfo({
      artist: {
        name: 'Hi-C',
        url: 'https://www.last.fm/music/Hi-C',
        stats: { listeners: '1234', playcount: '9' },
        tags: { tag: [{ name: 'underground rap' }, { name: 'plugg' }] },
        bio: {
          summary:
            'Rapper from &quot;somewhere&quot;. <a href="https://www.last.fm/music/Hi-C">Read more on Last.fm</a>'
        }
      }
    })
    expect(info).toEqual({
      name: 'Hi-C',
      url: 'https://www.last.fm/music/Hi-C',
      bio: 'Rapper from "somewhere".',
      tags: ['underground rap', 'plugg'],
      listeners: 1234
    })
  })

  it('gives null without an artist, and skips an empty bio', () => {
    expect(parseArtistInfo({})).toBeNull()
    expect(
      parseArtistInfo({
        artist: { name: 'X', bio: { summary: ' <a href="x">Read more on Last.fm</a>' } }
      })
    ).toEqual({ name: 'X', tags: [] })
  })
})
