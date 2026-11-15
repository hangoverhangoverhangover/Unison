import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceProvider } from '@shared/ipc'
import type { LikesSyncStatus } from '@shared/library'
import type { MusicProvider } from '@shared/provider'
import type { LikedTrack, Track } from '@shared/types'
import { openDb } from '../db'
import { createLikesSync, type LikesSyncOptions } from './reconcile'
import { createLikesStore, type LikesStore } from './store'

function svc(provider: ServiceProvider, nativeId: string): Track {
  return {
    id: `${provider}:${nativeId}`,
    provider,
    nativeId,
    title: `T${nativeId}`,
    artists: [],
    durationMs: 1
  }
}
const like = (t: Track, likedAt = '2024-01-01T00:00:00.000Z'): LikedTrack => ({ track: t, likedAt })

function fakeProvider(getLikes: () => Promise<LikedTrack[]>): MusicProvider {
  const no = (): never => {
    throw new Error('not used')
  }
  return {
    getLikes: vi.fn(getLikes),
    search: no,
    like: no,
    unlike: no,
    getPlaylists: no,
    getPlaylistTracks: no
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

interface Setup {
  store: LikesStore
  onChanged: ReturnType<typeof vi.fn>
  statuses: LikesSyncStatus[]
  logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
}

function setup(
  providers: Partial<Record<ServiceProvider, MusicProvider>>,
  extra: Partial<LikesSyncOptions> = {}
): Setup & { sync: ReturnType<typeof createLikesSync> } {
  const store = createLikesStore(openDb(':memory:'))
  const onChanged = vi.fn()
  const statuses: LikesSyncStatus[] = []
  const logger = { warn: vi.fn(), error: vi.fn() }
  const sync = createLikesSync({
    store,
    getProvider: (p) => providers[p],
    isConnected: (p) => !!providers[p],
    onChanged,
    onStatus: (s) => statuses.push(s),
    now: () => new Date('2025-06-01T00:00:00Z'),
    logger,
    ...extra
  })
  return { store, onChanged, statuses, logger, sync }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('likes sync', () => {
  it('syncs every connected service and reports status', async () => {
    const { store, sync, statuses, onChanged } = setup({
      spotify: fakeProvider(async () => [like(svc('spotify', '1'))]),
      soundcloud: fakeProvider(async () => [like(svc('soundcloud', '2'), '2024-02-01T00:00:00Z')])
    })
    await sync.syncNow()
    expect(store.getAll().map((l) => l.track.id)).toEqual(['soundcloud:2', 'spotify:1'])
    expect(statuses.map((s) => s.syncing)).toEqual([true, false])
    expect(sync.status()).toEqual({
      syncing: false,
      lastSyncedAt: { spotify: '2025-06-01T00:00:00.000Z', soundcloud: '2025-06-01T00:00:00.000Z' },
      errors: {}
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('skips services that are not connected and keeps their stored likes', async () => {
    const sc = fakeProvider(async () => [])
    const { store, sync } = setup(
      { spotify: fakeProvider(async () => []), soundcloud: sc },
      { isConnected: (p) => p === 'spotify' }
    )
    store.add(svc('soundcloud', '7'))
    await sync.syncNow()
    expect(sc.getLikes).not.toHaveBeenCalled()
    expect(store.has('soundcloud:7')).toBe(true)
    expect(sync.status().lastSyncedAt.soundcloud).toBeNull()
  })

  it('a failing service keeps its stored likes and records the error', async () => {
    let fail = true
    const { store, sync, onChanged } = setup({
      spotify: fakeProvider(async () => {
        if (fail) throw new Error('HTTP 503')
        return [like(svc('spotify', '1'))]
      }),
      soundcloud: fakeProvider(async () => [like(svc('soundcloud', '2'))])
    })
    store.add(svc('spotify', 'old'))
    await sync.syncNow()
    expect(store.has('spotify:old')).toBe(true)
    expect(store.has('soundcloud:2')).toBe(true)
    expect(sync.status().errors).toEqual({ spotify: 'HTTP 503' })
    expect(sync.status().lastSyncedAt.spotify).toBeNull()
    expect(onChanged).toHaveBeenCalledTimes(1)

    fail = false
    await sync.syncNow()
    expect(sync.status().errors).toEqual({})
    expect(sync.status().lastSyncedAt.spotify).toBe('2025-06-01T00:00:00.000Z')
    expect(store.has('spotify:old')).toBe(false)
  })

  it('dedupes concurrent syncNow calls', async () => {
    const d = deferred<LikedTrack[]>()
    const sp = fakeProvider(() => d.promise)
    const { sync } = setup({ spotify: sp })
    const a = sync.syncNow()
    const b = sync.syncNow()
    expect(b).toBe(a)
    expect(sync.status().syncing).toBe(true)
    d.resolve([])
    await a
    expect(sp.getLikes).toHaveBeenCalledTimes(1)
    await sync.syncNow()
    expect(sp.getLikes).toHaveBeenCalledTimes(2)
  })

  it('fires onChanged only when something changed', async () => {
    const { sync, onChanged } = setup({
      spotify: fakeProvider(async () => [like(svc('spotify', '1'))])
    })
    await sync.syncNow()
    await sync.syncNow()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('accepts an empty answer but warns when many likes were stored', async () => {
    const { store, sync, logger } = setup({ spotify: fakeProvider(async () => []) })
    for (let i = 0; i < 21; i++) store.add(svc('spotify', String(i)))
    await sync.syncNow()
    expect(store.getAll()).toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('schedules syncs on the interval without syncing on start', async () => {
    vi.useFakeTimers()
    const sp = fakeProvider(async () => [])
    const { sync } = setup({ spotify: sp }, { intervalMs: 1000 })
    sync.start()
    sync.start()
    expect(sp.getLikes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sp.getLikes).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sp.getLikes).toHaveBeenCalledTimes(3)
    sync.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sp.getLikes).toHaveBeenCalledTimes(3)
  })

  it('defaults to a 30 minute interval through the injected timer', () => {
    const setInterval = vi.fn(() => 42 as unknown as ReturnType<typeof globalThis.setInterval>)
    const clearInterval = vi.fn()
    const { sync } = setup({}, { setInterval, clearInterval })
    sync.start()
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60_000)
    sync.dispose()
    expect(clearInterval).toHaveBeenCalledWith(42)
  })

  it('recordLikeChange updates the table and fires onChanged', () => {
    const { store, sync, onChanged } = setup({})
    const t = svc('spotify', '1')
    expect(sync.recordLikeChange(t, true)).toBe(true)
    expect(store.has(t.id)).toBe(true)
    expect(sync.recordLikeChange(t, true)).toBe(false)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(sync.recordLikeChange(t, false)).toBe(true)
    expect(store.has(t.id)).toBe(false)
    expect(onChanged).toHaveBeenCalledTimes(2)
    const local: Track = { ...t, id: 'local:1', provider: 'local' }
    expect(sync.recordLikeChange(local, true)).toBe(false)
  })

  it('a like recorded during a sync is not undone by the older list', async () => {
    const d = deferred<LikedTrack[]>()
    const { store, sync } = setup({ spotify: fakeProvider(() => d.promise) })
    const running = sync.syncNow()
    sync.recordLikeChange(svc('spotify', 'new'), true)
    d.resolve([like(svc('spotify', 'other'))])
    await running
    expect(store.has('spotify:new')).toBe(true)
    expect(store.has('spotify:other')).toBe(false)
  })
})

describe('onNewLikes', () => {
  it('reports SoundCloud tracks liked since the stored table, newest first', async () => {
    let likes = [like(svc('soundcloud', '1'))]
    const onNewLikes = vi.fn()
    const { sync } = setup(
      {
        spotify: fakeProvider(async () => [like(svc('spotify', '9'))]),
        soundcloud: fakeProvider(async () => likes)
      },
      { onNewLikes }
    )
    await sync.syncNow()
    likes = [
      like(svc('soundcloud', '3'), '2024-03-01T00:00:00Z'),
      like(svc('soundcloud', '2'), '2024-02-01T00:00:00Z'),
      like(svc('soundcloud', '1'))
    ]
    await sync.syncNow()
    expect(onNewLikes).toHaveBeenCalledTimes(1)
    expect(onNewLikes.mock.calls[0]![0].map((t: Track) => t.id)).toEqual([
      'soundcloud:3',
      'soundcloud:2'
    ])
    // Nothing new: not called again.
    await sync.syncNow()
    expect(onNewLikes).toHaveBeenCalledTimes(1)
  })

  it('is not called on the first sync into an empty table', async () => {
    const onNewLikes = vi.fn()
    const { sync, store } = setup(
      {
        soundcloud: fakeProvider(async () => [
          like(svc('soundcloud', '1')),
          like(svc('soundcloud', '2'))
        ])
      },
      { onNewLikes }
    )
    await sync.syncNow()
    expect(store.snapshot('soundcloud').size).toBe(2)
    expect(onNewLikes).not.toHaveBeenCalled()
  })

  it('reports only new likes at startup against a table from an earlier run', async () => {
    const onNewLikes = vi.fn()
    const { sync, store } = setup(
      {
        soundcloud: fakeProvider(async () => [
          like(svc('soundcloud', '5'), '2024-05-01T00:00:00Z'),
          like(svc('soundcloud', '1'))
        ])
      },
      { onNewLikes }
    )
    store.add(svc('soundcloud', '1'), '2024-01-01T00:00:00.000Z')
    await sync.syncNow()
    expect(onNewLikes).toHaveBeenCalledWith([expect.objectContaining({ id: 'soundcloud:5' })])
  })

  it('skips tracks already stored (in-app likes) and never reports Spotify', async () => {
    let sc = [like(svc('soundcloud', '1'))]
    let sp = [like(svc('spotify', '1'))]
    const onNewLikes = vi.fn()
    const { sync } = setup(
      {
        spotify: fakeProvider(async () => sp),
        soundcloud: fakeProvider(async () => sc)
      },
      { onNewLikes }
    )
    await sync.syncNow()
    // Liked in the app: stored right away, so the next reconcile doesn't report it.
    sync.recordLikeChange(svc('soundcloud', '2'), true)
    sc = [like(svc('soundcloud', '2'), '2024-06-01T00:00:00Z'), ...sc]
    sp = [like(svc('spotify', '2')), ...sp]
    await sync.syncNow()
    expect(onNewLikes).not.toHaveBeenCalled()
  })

  it('is not called when the sync fails, and a throwing callback is only logged', async () => {
    let fail = false
    let likes = [like(svc('soundcloud', '1'))]
    const onNewLikes = vi.fn(() => {
      throw new Error('boom')
    })
    const { sync, store, logger } = setup(
      {
        soundcloud: fakeProvider(async () => {
          if (fail) throw new Error('HTTP 503')
          return likes
        })
      },
      { onNewLikes }
    )
    await sync.syncNow()
    likes = [like(svc('soundcloud', '2')), ...likes]
    fail = true
    await sync.syncNow()
    expect(onNewLikes).not.toHaveBeenCalled()
    fail = false
    await sync.syncNow()
    expect(onNewLikes).toHaveBeenCalledTimes(1)
    expect(store.has('soundcloud:2')).toBe(true)
    expect(logger.error).toHaveBeenCalledWith('[likes] onNewLikes failed:', expect.any(Error))
  })
})
