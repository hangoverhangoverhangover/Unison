import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceProvider } from '@shared/ipc'
import type { MusicProvider, PlaylistCreator } from '@shared/provider'
import type { Playlist, Track } from '@shared/types'
import { DATADOME_MESSAGE, SoundCloudApiError, SoundCloudDataDomeError } from '../soundcloud/api'
import {
  createLimiter,
  createPacer,
  createSearchGates,
  createTransfer,
  isSoundCloudRateLimit,
  PlanCancelledError,
  planTransfer,
  PROGRESS_INTERVAL_MS,
  RATE_LIMIT_BACKOFF_MS,
  rankCandidates,
  SEARCH_CONCURRENCY,
  searchQueries,
  SOUNDCLOUD_LIMITED_MESSAGE,
  SOUNDCLOUD_SEARCH_GAP_MS
} from './plan'

const t = (id: string, title: string, artists: string[], extra: Partial<Track> = {}): Track => {
  const [provider, nativeId] = id.split(':') as [Track['provider'], string]
  return { id, provider, nativeId, title, artists, durationMs: 200_000, ...extra }
}

type Search = (q: string) => Track[] | Promise<Track[]>

function fakeProvider(search: Search): MusicProvider & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    search: vi.fn(async (q: string) => {
      queries.push(q)
      return search(q)
    }),
    getLikes: async () => [],
    like: async () => {},
    unlike: async () => {},
    getPlaylists: async () => [],
    getPlaylistTracks: async () => []
  }
}

function deps(
  tracks: Track[],
  providers: Partial<Record<ServiceProvider, MusicProvider>>,
  extra: Partial<Parameters<typeof planTransfer>[0]> = {}
): Parameters<typeof planTransfer>[0] {
  return {
    getProvider: (s) => providers[s],
    getPlaylistTracks: async () => tracks,
    ...extra
  }
}

describe('searchQueries', () => {
  it('uses artist + cleaned title, and adds the prefix reading for archive uploads', () => {
    expect(searchQueries(t('soundcloud:1', 'Song (feat. X)', ['Artist']))).toEqual(['Artist Song'])
    expect(searchQueries(t('soundcloud:1', 'Real Artist - Song', ['archiveguy']))).toEqual([
      'archiveguy Real Artist - Song',
      'Real Artist Song'
    ])
    expect(searchQueries(t('soundcloud:1', 'Artist - Song', ['Artist']))).toEqual(['Artist Song'])
  })

  it('searches local files without an artist tag by title', () => {
    expect(searchQueries(t('local:1', 'Just A Title', []))).toEqual(['Just A Title'])
  })
})

describe('rankCandidates', () => {
  it('orders isrc, exact, close and drops non-matches; max 5', () => {
    const src = t('soundcloud:1', 'Song', ['Artist'], { isrc: 'USAAA2400001' })
    const results = [
      t('spotify:close', 'Songs', ['Artist']),
      t('spotify:none', 'Other', ['Artist']),
      t('spotify:exact', 'Song', ['Artist']),
      t('spotify:isrc', 'Different name', ['Someone'], { isrc: 'US-AAA-24-00001' })
    ]
    const ranked = rankCandidates(src, results)
    expect(ranked.map((m) => [m.track.id, m.confidence])).toEqual([
      ['spotify:isrc', 'isrc'],
      ['spotify:exact', 'exact'],
      ['spotify:close', 'close']
    ])
    const many = Array.from({ length: 8 }, (_, i) => t(`spotify:${i}`, 'Song', ['Artist']))
    expect(rankCandidates(src, many)).toHaveLength(5)
  })
})

describe('planTransfer', () => {
  it('finds isrc, exact, close and none on Spotify (isrc: search first)', async () => {
    const source = [
      t('soundcloud:a', 'Alpha', ['Ann'], { isrc: 'USAAA2400001' }),
      t('soundcloud:b', 'Beta', ['Bob']),
      t('soundcloud:c', 'Gamma Ray', ['Cat']),
      t('soundcloud:d', 'Nothing', ['Dan'])
    ]
    const spotify = fakeProvider((q) => {
      if (q === 'isrc:USAAA2400001')
        return [t('spotify:A', 'Alpha - 2011 Mix', ['Ann'], { isrc: 'USAAA2400001' })]
      if (q === 'Bob Beta') return [t('spotify:B', 'Beta', ['Bob'])]
      if (q === 'Cat Gamma Ray') return [t('spotify:C', 'Gamma Rays', ['Cat'])]
      return [t('spotify:X', 'Unrelated', ['Zed'])]
    })
    const plan = await planTransfer(deps(source, { spotify }), 'soundcloud:pl', 'spotify')
    expect(plan.sourcePlaylistId).toBe('soundcloud:pl')
    expect(plan.target).toBe('spotify')
    expect(plan.candidates.map((c) => c.matches.map((m) => [m.track.id, m.confidence]))).toEqual([
      [['spotify:A', 'isrc']],
      [['spotify:B', 'exact']],
      [['spotify:C', 'close']],
      []
    ])
    expect(spotify.queries).toContain('isrc:USAAA2400001')
  })

  it('matches SoundCloud archive uploads "Artist - Title" to the plain title', async () => {
    const source = [t('spotify:1', 'Flickermood', ['Forss'])]
    const soundcloud = fakeProvider(() => [
      t('soundcloud:9', 'Forss - Flickermood', ['archive account'])
    ])
    const plan = await planTransfer(deps(source, { soundcloud }), 'spotify:pl', 'soundcloud')
    expect(plan.candidates[0]!.matches).toEqual([
      { track: expect.objectContaining({ id: 'soundcloud:9' }), confidence: 'exact' }
    ])
    // SoundCloud has no ISRC search.
    expect(soundcloud.queries.every((q) => !q.startsWith('isrc:'))).toBe(true)
  })

  it('marks SoundCloud results with the same ISRC as isrc', async () => {
    const source = [t('spotify:1', 'Song', ['A'], { isrc: 'USAAA2400001' })]
    const soundcloud = fakeProvider(() => [
      t('soundcloud:9', 'Song (Radio Edit)', ['A'], { isrc: 'USAAA2400001' })
    ])
    const plan = await planTransfer(deps(source, { soundcloud }), 'spotify:pl', 'soundcloud')
    expect(plan.candidates[0]!.matches[0]!.confidence).toBe('isrc')
  })

  it('passes tracks already on the target through without searching', async () => {
    const own = t('spotify:own', 'Mine', ['Me'])
    const spotify = fakeProvider(() => [])
    const plan = await planTransfer(deps([own], { spotify }), 'app:1', 'spotify')
    expect(plan.candidates[0]!.matches).toEqual([{ track: own, confidence: 'isrc' }])
    expect(spotify.queries).toEqual([])
  })

  it('searches local tracks by their tags', async () => {
    const local = t('local:abc', 'Tagged Title', ['Tag Artist'], { localPath: 'C:\\m\\x.mp3' })
    const spotify = fakeProvider((q) =>
      q === 'Tag Artist Tagged Title' ? [t('spotify:z', 'Tagged Title', ['Tag Artist'])] : []
    )
    const plan = await planTransfer(deps([local], { spotify }), 'app:1', 'spotify')
    expect(plan.candidates[0]!.matches[0]).toMatchObject({ confidence: 'exact' })
  })

  it('caps searches at 3 in flight', async () => {
    let active = 0
    let peak = 0
    const spotify = fakeProvider(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return []
    })
    const source = Array.from({ length: 12 }, (_, i) =>
      t(`soundcloud:${i}`, `Song ${i}`, ['A'], { isrc: `USAAA24${String(i).padStart(5, '0')}` })
    )
    await planTransfer(deps(source, { spotify }), 'soundcloud:pl', 'spotify')
    expect(spotify.queries).toHaveLength(24)
    expect(peak).toBe(SEARCH_CONCURRENCY)
  })

  it('emits throttled progress, always the first and the last', async () => {
    let clock = 0
    const events: { done: number; total: number }[] = []
    const spotify = fakeProvider(() => {
      clock += 100
      return []
    })
    const source = Array.from({ length: 10 }, (_, i) => t(`soundcloud:${i}`, `S${i}`, ['A']))
    await planTransfer(
      deps(source, { spotify }, { now: () => clock, onProgress: (p) => events.push(p) }),
      'soundcloud:pl',
      'spotify'
    )
    expect(events[0]).toEqual({ done: 0, total: 10 })
    expect(events.at(-1)).toEqual({ done: 10, total: 10 })
    expect(events.length).toBeLessThan(10)
    for (let i = 2; i < events.length - 1; i++)
      expect(events[i]!.done).toBeGreaterThan(events[i - 1]!.done)
    expect(PROGRESS_INTERVAL_MS).toBe(250)
  })

  it('rejects unknown targets, missing providers, and fails when every search fails', async () => {
    await expect(planTransfer(deps([], {}), 'app:1', 'spotify')).rejects.toThrow(/isn't connected/)
    await expect(planTransfer(deps([], {}), 'app:1', 'tidal' as ServiceProvider)).rejects.toThrow(
      /Unknown/
    )
    const broken = fakeProvider(() => {
      throw new Error('boom')
    })
    await expect(
      planTransfer(deps([t('soundcloud:1', 'S', ['A'])], { spotify: broken }), 'x:1', 'spotify')
    ).rejects.toThrow('boom')
  })

  it('keeps going when only some searches fail', async () => {
    const spotify = fakeProvider((q) => {
      if (q.includes('Bad')) throw new Error('boom')
      return [t('spotify:g', 'Good', ['A'])]
    })
    const source = [t('soundcloud:1', 'Good', ['A']), t('soundcloud:2', 'Bad', ['A'])]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plan = await planTransfer(deps(source, { spotify }), 'soundcloud:pl', 'spotify')
    warn.mockRestore()
    expect(plan.candidates.map((c) => c.matches.length)).toEqual([1, 0])
  })
})

describe('planTransfer pacing and rate limits (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const limited = (): SoundCloudApiError =>
    new SoundCloudApiError(429, 'SoundCloud is rate limiting requests. Try again in a few minutes.')

  /** Settles `p` while running every fake timer; returns the outcome. */
  async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
    const out = p.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await vi.runAllTimersAsync()
    return out
  }

  it('runs SoundCloud searches one at a time, 1.5 s apart (archive searches count)', async () => {
    const starts: number[] = []
    let active = 0
    let peak = 0
    const soundcloud = fakeProvider(async () => {
      starts.push(Date.now())
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 200))
      active--
      return []
    })
    const source = [
      t('spotify:1', 'One', ['A']),
      t('spotify:2', 'Real Artist - Two', ['archiveguy']),
      t('spotify:3', 'Three', ['A']),
      t('spotify:4', 'Four', ['A'])
    ]
    const r = await settle(planTransfer(deps(source, { soundcloud }), 'spotify:pl', 'soundcloud'))
    expect(r.error).toBeUndefined()
    expect(soundcloud.queries).toHaveLength(5)
    expect(peak).toBe(1)
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(SOUNDCLOUD_SEARCH_GAP_MS)
  })

  it('shares the pacing between plans given the same gates', async () => {
    const starts: number[] = []
    const soundcloud = fakeProvider(() => {
      starts.push(Date.now())
      return []
    })
    const gates = createSearchGates()
    const a = planTransfer(
      deps([t('spotify:1', 'One', ['A'])], { soundcloud }, { gates }),
      'spotify:a',
      'soundcloud'
    )
    const b = planTransfer(
      deps([t('spotify:2', 'Two', ['A'])], { soundcloud }, { gates }),
      'spotify:b',
      'soundcloud'
    )
    await settle(Promise.all([a, b]))
    expect(starts).toHaveLength(2)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(SOUNDCLOUD_SEARCH_GAP_MS)
  })

  it('retries a rate-limited search after 5 s and 15 s, then carries on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const starts: number[] = []
    let calls = 0
    const soundcloud = fakeProvider(() => {
      starts.push(Date.now())
      if (++calls <= 2) throw limited()
      return [t('soundcloud:9', 'One', ['A'])]
    })
    const r = await settle(
      planTransfer(deps([t('spotify:1', 'One', ['A'])], { soundcloud }), 'spotify:pl', 'soundcloud')
    )
    expect(r.value?.candidates[0]!.matches[0]!.track.id).toBe('soundcloud:9')
    expect(starts.map((s) => s - starts[0]!)).toEqual([0, 5_000, 20_000])
  })

  it('gives up after 5 s, 15 s, 45 s with a readable error and stops every search', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const starts: number[] = []
    const soundcloud = fakeProvider(() => {
      starts.push(Date.now())
      throw limited()
    })
    const events: { done: number; total: number }[] = []
    const source = [
      t('spotify:1', 'One', ['A']),
      t('spotify:2', 'Two', ['A']),
      t('spotify:3', 'Three', ['A'])
    ]
    const r = await settle(
      planTransfer(
        deps(source, { soundcloud }, { onProgress: (p) => events.push(p) }),
        'spotify:pl',
        'soundcloud'
      )
    )
    expect((r.error as Error).message).toBe(SOUNDCLOUD_LIMITED_MESSAGE)
    expect(RATE_LIMIT_BACKOFF_MS).toEqual([5_000, 15_000, 45_000])
    // One search and its three retries; the other tracks never ask.
    expect(starts.map((s) => s - starts[0]!)).toEqual([0, 5_000, 20_000, 65_000])
    expect(events).toEqual([{ done: 0, total: 3 }])
  })

  it('treats the DataDome check as a limit too, and ends with its log-in message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const soundcloud = fakeProvider(() => {
      throw new SoundCloudDataDomeError()
    })
    const r = await settle(
      planTransfer(deps([t('spotify:1', 'One', ['A'])], { soundcloud }), 'spotify:pl', 'soundcloud')
    )
    expect((r.error as Error).message).toBe(DATADOME_MESSAGE)
    expect(soundcloud.queries).toHaveLength(4)
  })

  it('does not retry Spotify failures in the plan (its client honours Retry-After)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spotify = fakeProvider((q) => {
      if (q.includes('Bad')) throw limited()
      return [t('spotify:g', 'Good', ['A'])]
    })
    const r = await settle(
      planTransfer(
        deps([t('soundcloud:1', 'Bad', ['A']), t('soundcloud:2', 'Good', ['A'])], { spotify }),
        'soundcloud:pl',
        'spotify'
      )
    )
    expect(r.error).toBeUndefined()
    expect(spotify.queries.filter((q) => q.includes('Bad'))).toHaveLength(1)
  })

  it('progress never goes down, with retries and concurrent searches', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const delays = [700, 10, 300, 50, 900, 5, 400, 120, 60, 800]
    let n = 0
    const failed = new Set<string>()
    const run = async (q: string): Promise<Track[]> => {
      const i = n++
      await new Promise((r) => setTimeout(r, delays[i % delays.length]))
      // Every third query is rate limited once.
      if (i % 3 === 0 && !failed.has(q)) {
        failed.add(q)
        throw limited()
      }
      // One real match, so a failed Spotify search doesn't look like "everything failed".
      return [t('spotify:m', 'Song 0', ['A']), t('soundcloud:m', 'Song 0', ['A'])]
    }
    for (const target of ['soundcloud', 'spotify'] as const) {
      const provider = fakeProvider(run)
      const other = target === 'soundcloud' ? 'spotify' : 'soundcloud'
      const source = Array.from({ length: 12 }, (_, i) =>
        t(`${other}:${i}`, i % 2 ? `Someone - Song ${i}` : `Song ${i}`, ['A'])
      )
      const events: { done: number; total: number }[] = []
      const r = await settle(
        planTransfer(
          deps(
            source,
            { [target]: provider },
            { now: () => Date.now(), onProgress: (p) => events.push(p) }
          ),
          `${other}:pl`,
          target
        )
      )
      expect(r.error).toBeUndefined()
      expect(events[0]).toEqual({ done: 0, total: 12 })
      expect(events.at(-1)).toEqual({ done: 12, total: 12 })
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.total).toBe(12)
        expect(events[i]!.done).toBeGreaterThan(events[i - 1]!.done)
      }
    }
  })

  it('stops without more searches or progress when cancelled', async () => {
    const soundcloud = fakeProvider(() => [])
    const events: { done: number; total: number }[] = []
    const ac = new AbortController()
    const source = Array.from({ length: 5 }, (_, i) => t(`spotify:${i}`, `Song ${i}`, ['A']))
    const outcome = planTransfer(
      deps(source, { soundcloud }, { signal: ac.signal, onProgress: (p) => events.push(p) }),
      'spotify:pl',
      'soundcloud'
    ).then(
      () => undefined,
      (e: unknown) => e
    )
    await vi.advanceTimersByTimeAsync(SOUNDCLOUD_SEARCH_GAP_MS + 10)
    const seen = soundcloud.queries.length
    const emitted = events.length
    ac.abort()
    await vi.runAllTimersAsync()
    expect(await outcome).toBeInstanceOf(PlanCancelledError)
    expect(seen).toBe(2)
    expect(soundcloud.queries).toHaveLength(seen)
    expect(events).toHaveLength(emitted)
  })

  it('passes SoundCloud tracks through when copying to SoundCloud', async () => {
    const own = t('soundcloud:own', 'Mine', ['Me'])
    const soundcloud = fakeProvider(() => [])
    const r = await settle(planTransfer(deps([own], { soundcloud }), 'app:1', 'soundcloud'))
    expect(r.value?.candidates[0]!.matches).toEqual([{ track: own, confidence: 'isrc' }])
    expect(soundcloud.queries).toEqual([])
  })

  it('createPacer spaces concurrent callers by start time', async () => {
    const pace = createPacer(1000)
    const starts: number[] = []
    const all = Promise.all(
      [0, 1, 2].map(async () => {
        await pace()
        starts.push(Date.now())
      })
    )
    await vi.runAllTimersAsync()
    await all
    expect(starts.map((s) => s - starts[0]!)).toEqual([0, 1000, 2000])
  })
})

describe('isSoundCloudRateLimit', () => {
  it('spots 429s, "please wait" replies and DataDome, nothing else', () => {
    expect(isSoundCloudRateLimit(new SoundCloudApiError(429, 'x'))).toBe(true)
    expect(
      isSoundCloudRateLimit(
        new SoundCloudApiError(400, 'SoundCloud GET /search/tracks failed (400): please wait 1s')
      )
    ).toBe(true)
    expect(isSoundCloudRateLimit(new SoundCloudDataDomeError())).toBe(true)
    expect(isSoundCloudRateLimit(new SoundCloudApiError(500, 'boom'))).toBe(false)
    expect(isSoundCloudRateLimit(new Error('429'))).toBe(false)
  })
})

describe('createLimiter', () => {
  it('never exceeds the limit, even with newcomers arriving as slots free up', async () => {
    const run = createLimiter(2)
    let active = 0
    let peak = 0
    const job = async (): Promise<void> => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
    }
    // Each finished job immediately queues another: the newcomer must not jump the queue.
    const first = Array.from({ length: 6 }, () => run(job).then(() => run(job)))
    await Promise.all(first)
    expect(peak).toBe(2)
  })
})

describe('createTransfer', () => {
  const creator = (): MusicProvider &
    PlaylistCreator & { created: { name: string; tracks: Track[] }[] } => {
    const created: { name: string; tracks: Track[] }[] = []
    return {
      ...fakeProvider(() => []),
      created,
      async createPlaylist(name: string, tracks: Track[]): Promise<Playlist> {
        created.push({ name, tracks })
        return { id: 'spotify:new', source: 'spotify', nativeId: 'new', name, canEdit: true }
      }
    }
  }

  it('creates through PlaylistCreator and refreshes the list', async () => {
    const spotify = creator()
    const onCreated = vi.fn()
    const tracks = [t('spotify:a', 'A', ['x']), t('spotify:b', 'B', ['x'])]
    const result = await createTransfer(
      { getProvider: (s) => (s === 'spotify' ? spotify : undefined), onCreated },
      { target: 'spotify', name: '  My copy ', tracks }
    )
    expect(result).toEqual({ playlistId: 'spotify:new', added: 2 })
    expect(spotify.created).toEqual([{ name: 'My copy', tracks }])
    expect(onCreated).toHaveBeenCalledWith('spotify:new')
  })

  it('rejects tracks from another service before calling the provider', async () => {
    const spotify = creator()
    await expect(
      createTransfer(
        { getProvider: () => spotify },
        { target: 'spotify', name: 'x', tracks: [t('soundcloud:1', 'A', ['x'])] }
      )
    ).rejects.toThrow(/Spotify track/)
    expect(spotify.created).toHaveLength(0)
  })

  it('rejects empty names, empty lists, and providers that cannot create', async () => {
    const tracks = [t('soundcloud:1', 'A', ['x'])]
    const plain = fakeProvider(() => [])
    await expect(
      createTransfer({ getProvider: () => plain }, { target: 'soundcloud', name: ' ', tracks })
    ).rejects.toThrow(/name/)
    await expect(
      createTransfer({ getProvider: () => plain }, { target: 'soundcloud', name: 'x', tracks: [] })
    ).rejects.toThrow(/No tracks/)
    await expect(
      createTransfer({ getProvider: () => plain }, { target: 'soundcloud', name: 'x', tracks })
    ).rejects.toThrow(/can't create/)
    await expect(
      createTransfer({ getProvider: () => undefined }, { target: 'soundcloud', name: 'x', tracks })
    ).rejects.toThrow(/isn't connected/)
  })
})
