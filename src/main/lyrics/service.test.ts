import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import type { SettingsStore } from '../spotify/tokens'
import { createLyrics } from './service'

const track = (extra: Partial<Track> = {}): Track =>
  ({
    id: 'soundcloud:9',
    provider: 'soundcloud',
    nativeId: '9',
    title: 'Glasshouse',
    artists: ['Neon Harbor', 'Feat'],
    album: 'Afterglow',
    durationMs: 200_400,
    ...extra
  }) as Track

let store: Map<string, string>
let calls: string[]
let replies: { status: number; body: unknown }[]
let now: number

function make(): ReturnType<typeof createLyrics> {
  const settings: SettingsStore = {
    get: (k) => store.get(k),
    set: (k, v) => void store.set(k, v),
    delete: (k) => void store.delete(k)
  }
  return createLyrics({
    settings,
    userAgent: 'Unison test',
    now: () => now,
    fetch: vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(`${url} UA=${init?.headers?.['User-Agent']}`)
      const r = replies.shift() ?? { status: 404, body: { name: 'TrackNotFound' } }
      return {
        ok: r.status < 400,
        status: r.status,
        headers: { get: () => 'application/json' },
        json: async () => r.body
      } as unknown as Response
    }) as unknown as typeof fetch
  })
}

beforeEach(() => {
  store = new Map()
  calls = []
  replies = []
  now = 1_000_000
})

describe('lyrics service', () => {
  it('asks LRCLIB with title, first artist, album and duration in seconds, identifying itself', async () => {
    replies.push({
      status: 200,
      body: { syncedLyrics: '[00:01.00]Hi', plainLyrics: 'Hi', instrumental: false }
    })
    const r = await make().get(track())
    expect(calls[0]).toBe(
      'https://lrclib.net/api/get?track_name=Glasshouse&artist_name=Neon+Harbor&album_name=Afterglow&duration=200 UA=Unison test'
    )
    expect(r).toEqual({
      source: 'lrclib',
      synced: [{ timeMs: 1000, text: 'Hi' }],
      plain: 'Hi',
      instrumental: false
    })
  })

  it('caches answers, including "not found", so it asks only once', async () => {
    const lyrics = make()
    await lyrics.get(track()) // 404 then search: empty
    replies.push({ status: 200, body: [] })
    const second = await lyrics.get(track())
    expect(second.source).toBe('none')
    expect(calls.length).toBe(2) // get + search, then cached
  })

  it('falls back to search and takes the result closest in length (within 3 s)', async () => {
    replies.push({ status: 404, body: {} })
    replies.push({
      status: 200,
      body: [
        { duration: 150, syncedLyrics: '[00:01.00]Wrong', plainLyrics: 'Wrong' },
        { duration: 201, syncedLyrics: '[00:01.00]Right', plainLyrics: 'Right' }
      ]
    })
    const r = await make().get(track())
    expect(r.synced?.[0]?.text).toBe('Right')
    expect(calls[1]).toContain('/api/search?track_name=Glasshouse&artist_name=Neon+Harbor')
  })

  it("doesn't cache when LRCLIB is busy (429), so it tries again later", async () => {
    const lyrics = make()
    replies.push({ status: 429, body: {} })
    expect((await lyrics.get(track())).source).toBe('none')
    replies.push({ status: 200, body: { plainLyrics: 'Later', syncedLyrics: null } })
    expect((await lyrics.get(track())).plain).toBe('Later')
  })

  it("the user's own lyrics win and stay until deleted", async () => {
    const lyrics = make()
    lyrics.save(track(), '[00:02.00]Mine')
    const r = await lyrics.get(track())
    expect(r).toEqual({
      source: 'user',
      synced: [{ timeMs: 2000, text: 'Mine' }],
      plain: 'Mine',
      instrumental: false
    })
    expect(calls).toEqual([])
    lyrics.remove(track())
    replies.push({ status: 200, body: { plainLyrics: 'Theirs', syncedLyrics: null } })
    expect((await lyrics.get(track())).plain).toBe('Theirs')
  })

  it('saves plain (unsynced) lyrics too', async () => {
    const lyrics = make()
    lyrics.save(track(), 'line one\nline two')
    const r = await lyrics.get(track())
    expect(r).toMatchObject({ source: 'user', synced: null, plain: 'line one\nline two' })
  })
})

describe('Genius backup (QoL 4)', () => {
  const page =
    '<div data-lyrics-container="true">[Verse]<br>Glass in the house<br>Light in the room</div>'
  function withGenius(
    token: string | null,
    geniusHits: unknown[]
  ): {
    lyrics: ReturnType<typeof createLyrics>
    asked: string[]
  } {
    const asked: string[] = []
    const settings: SettingsStore = {
      get: (k) => store.get(k),
      set: (k, v) => void store.set(k, v),
      delete: (k) => void store.delete(k)
    }
    const lyrics = createLyrics({
      settings,
      userAgent: 'Unison test',
      now: () => now,
      geniusToken: () => token,
      fetch: (async (url: string) => {
        asked.push(url.split('?')[0]!)
        if (url.startsWith('https://api.genius.com'))
          return new Response(JSON.stringify({ response: { hits: geniusHits } }), { status: 200 })
        if (url.startsWith('https://genius.com')) return new Response(page, { status: 200 })
        return new Response(JSON.stringify({ name: 'TrackNotFound' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      }) as unknown as typeof fetch
    })
    return { lyrics, asked }
  }
  const hit = {
    type: 'song',
    result: {
      title: 'Glasshouse',
      url: 'https://genius.com/Neon-harbor-glasshouse-lyrics',
      lyrics_state: 'complete',
      primary_artist: { name: 'Neon Harbor' }
    }
  }

  it('asks Genius only when LRCLIB has nothing, and caches the plain lyrics', async () => {
    const { lyrics, asked } = withGenius('tok', [hit])
    const r = await lyrics.get(track())
    expect(r).toEqual({
      source: 'genius',
      synced: null,
      plain: 'Glass in the house\nLight in the room',
      instrumental: false,
      url: 'https://genius.com/Neon-harbor-glasshouse-lyrics'
    })
    const n = asked.length
    expect(await lyrics.get(track())).toEqual(r)
    expect(asked.length).toBe(n)
  })

  it('never asks Genius without a token or when LRCLIB has lyrics', async () => {
    const none = withGenius(null, [hit])
    expect((await none.lyrics.get(track())).source).toBe('none')
    expect(none.asked.some((u) => u.includes('genius'))).toBe(false)
    store.clear()
    replies.push({ status: 200, body: { plainLyrics: 'From LRCLIB', instrumental: false } })
    expect((await make().get(track())).source).toBe('lrclib')
  })

  it('a miss cached before the token was added asks Genius once', async () => {
    await withGenius(null, [hit]).lyrics.get(track())
    const later = withGenius('tok', [hit])
    expect((await later.lyrics.get(track())).source).toBe('genius')
    expect(later.asked.filter((u) => u.includes('lrclib'))).toEqual([])
  })
})
