import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackState } from '@shared/playback'
import type { Provider, Track } from '@shared/types'
import type { BackendEvent, PlaybackBackend } from './backend'
import {
  createPlaybackController,
  MUTED_KEY,
  NONE_PLAYABLE_MESSAGE,
  VOLUME_KEY,
  type PlaybackController
} from './controller'

function track(n: number | string, provider: Provider = 'local'): Track {
  return {
    id: `${provider}:${n}`,
    provider,
    nativeId: String(n),
    title: `Track ${n}`,
    artists: ['A'],
    durationMs: 200_000
  }
}

class FakeBackend implements PlaybackBackend {
  handlers = new Set<(e: BackendEvent) => void>()
  loaded: Track | null = null
  loads: string[] = []
  position = 0
  playing = false
  volume = -1
  muted = false
  stops = 0
  /** nativeIds whose load() rejects. */
  broken = new Set<string>()

  constructor(private providers: Provider[] = ['local']) {}

  canPlay(t: Track): boolean {
    return this.providers.includes(t.provider)
  }
  async load(t: Track, startMs = 0): Promise<void> {
    this.loads.push(t.nativeId)
    this.loaded = t
    this.position = startMs
    this.playing = false
    if (this.broken.has(t.nativeId)) throw new Error(`broken ${t.nativeId}`)
  }
  async play(): Promise<void> {
    this.playing = true
  }
  pause(): void {
    this.playing = false
  }
  seek(ms: number): void {
    this.position = ms
  }
  setVolume(v: number, m: boolean): void {
    this.volume = v
    this.muted = m
  }
  getPositionMs(): number {
    return this.position
  }
  getDurationMs(): number {
    return this.loaded ? 180_000 : 0
  }
  stop(): void {
    this.stops++
    this.loaded = null
    this.playing = false
  }
  on(h: (e: BackendEvent) => void): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }
  emit(e: BackendEvent): void {
    for (const h of this.handlers) h(e)
  }
}

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v)
  } as Storage
}

let uidN = 0
const uid = (): string => `u${++uidN}`
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

let backend: FakeBackend
let storage: Storage
let c: PlaybackController
let states: PlaybackState[]

beforeEach(() => {
  backend = new FakeBackend()
  storage = memoryStorage()
  c = createPlaybackController([backend], { storage, queue: { uid, rng: () => 0.5 } })
  states = []
  c.subscribe((s) => states.push(s))
})
afterEach(() => {
  c.dispose()
  vi.useRealTimers()
})

const cur = (): string | undefined => c.getState().current?.track.nativeId

describe('basic playback', () => {
  it('starts idle', () => {
    expect(c.getState().status).toBe('idle')
    expect(c.getState().current).toBeNull()
  })

  it('playTracks loads and plays the start track', async () => {
    await c.playTracks([track(1), track(2), track(3)], 1)
    const s = c.getState()
    expect(s.status).toBe('playing')
    expect(cur()).toBe('2')
    expect(s.queue.map((i) => i.track.nativeId)).toEqual(['3'])
    expect(s.durationMs).toBe(180_000)
    expect(backend.playing).toBe(true)
    expect(states.map((x) => x.status)).toEqual(['loading', 'playing'])
  })

  it('pause, play and toggle', async () => {
    await c.playTracks([track(1)], 0)
    c.pause()
    expect(c.getState().status).toBe('paused')
    expect(backend.playing).toBe(false)
    await c.toggle()
    expect(c.getState().status).toBe('playing')
    await c.toggle()
    expect(c.getState().status).toBe('paused')
  })

  it('play with nothing current starts the queue', async () => {
    c.addToQueue([track(1), track(2)])
    expect(c.getState().status).toBe('idle')
    await c.play()
    expect(cur()).toBe('1')
    expect(c.getState().status).toBe('playing')
  })

  it('snapshots are immutable and change identity on each emit', async () => {
    await c.playTracks([track(1), track(2)], 0)
    const s = c.getState()
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.queue)).toBe(true)
    c.setShuffle(true)
    expect(c.getState()).not.toBe(s)
    expect(s.shuffle).toBe(false)
  })
})

describe('state stream', () => {
  it('does not emit on time ticks, only on changes and seeks', async () => {
    await c.playTracks([track(1)], 0)
    const n = states.length
    backend.position = 5000
    expect(c.getPositionMs()).toBe(5000)
    backend.position = 6000
    expect(c.getPositionMs()).toBe(6000)
    expect(states.length).toBe(n)
    c.seek(30_000)
    expect(states.length).toBe(n + 1)
    expect(states.at(-1)!.positionMs).toBe(30_000)
    expect(backend.position).toBe(30_000)
  })

  it('does not emit duplicates for redundant backend events', async () => {
    await c.playTracks([track(1)], 0)
    const n = states.length
    backend.emit({ type: 'playing' })
    expect(states.length).toBe(n)
    backend.emit({ type: 'paused' })
    expect(states.length).toBe(n + 1)
    expect(c.getState().status).toBe('paused')
  })

  it('emits on queue, shuffle, repeat and duration changes', async () => {
    await c.playTracks([track(1), track(2)], 0)
    let n = states.length
    c.addToQueue([track(3)])
    expect(states.length).toBe(++n)
    c.cycleRepeat()
    expect(states.length).toBe(++n)
    c.setShuffle(true)
    expect(states.length).toBe(++n)
    backend.emit({ type: 'duration', durationMs: 123_000 })
    expect(states.length).toBe(n + 1)
    expect(c.getState().durationMs).toBe(123_000)
  })

  it('seek clamps to the duration', async () => {
    await c.playTracks([track(1)], 0)
    c.seek(10_000_000)
    expect(backend.position).toBe(180_000)
    c.seek(-5)
    expect(backend.position).toBe(0)
  })

  it('unsubscribe stops updates', async () => {
    const seen: PlaybackState[] = []
    const off = c.subscribe((s) => seen.push(s))
    off()
    await c.playTracks([track(1)], 0)
    expect(seen).toEqual([])
  })
})

describe('repeat and end of track', () => {
  it('cycles repeat off -> all -> one -> off', () => {
    expect(c.getState().repeat).toBe('off')
    c.cycleRepeat()
    expect(c.getState().repeat).toBe('all')
    c.cycleRepeat()
    expect(c.getState().repeat).toBe('one')
    c.cycleRepeat()
    expect(c.getState().repeat).toBe('off')
  })

  it('natural end advances', async () => {
    await c.playTracks([track(1), track(2)], 0)
    backend.emit({ type: 'ended' })
    await flush()
    expect(cur()).toBe('2')
    expect(c.getState().status).toBe('playing')
  })

  it('natural end with repeat one replays the same track', async () => {
    await c.playTracks([track(1), track(2)], 0)
    c.cycleRepeat()
    c.cycleRepeat() // one
    backend.position = 179_000
    backend.playing = false
    backend.emit({ type: 'ended' })
    await flush()
    expect(cur()).toBe('1')
    expect(backend.position).toBe(0)
    expect(backend.playing).toBe(true)
    expect(backend.loads).toEqual(['1'])
  })

  it('marks endedAt when the last song finishes by itself, not on a user next', async () => {
    await c.playTracks([track(1)], 0)
    expect(c.getState().endedAt).toBeUndefined()
    await c.next()
    expect(c.getState().endedAt).toBeUndefined()
    await c.playTracks([track(1)], 0)
    backend.position = 179_000
    backend.playing = false
    backend.emit({ type: 'ended' })
    await flush()
    expect(c.getState().endedAt).toBe(1)
    expect(c.getState().status).toBe('paused')
  })

  it('user next with repeat one advances', async () => {
    await c.playTracks([track(1), track(2)], 0)
    c.cycleRepeat()
    c.cycleRepeat()
    await c.next()
    expect(cur()).toBe('2')
  })

  it('end of queue with repeat off stays on the last track, paused at 0', async () => {
    await c.playTracks([track(1)], 0)
    backend.position = 180_000
    backend.emit({ type: 'ended' })
    await flush()
    const s = c.getState()
    expect(cur()).toBe('1')
    expect(s.status).toBe('paused')
    expect(s.positionMs).toBe(0)
    expect(backend.position).toBe(0)
  })

  it('end of queue with repeat all wraps to the start', async () => {
    await c.playTracks([track(1), track(2)], 0)
    c.cycleRepeat()
    await c.next()
    backend.emit({ type: 'ended' })
    await flush()
    expect(cur()).toBe('1')
    expect(c.getState().queue.map((i) => i.track.nativeId)).toEqual(['2'])
  })
})

describe('previous', () => {
  it('restarts the current track when past 3s', async () => {
    await c.playTracks([track(1), track(2)], 0)
    await c.next()
    backend.position = 3500
    await c.previous()
    expect(cur()).toBe('2')
    expect(backend.position).toBe(0)
  })

  it('goes to the previous track within the first 3s', async () => {
    await c.playTracks([track(1), track(2)], 0)
    await c.next()
    backend.position = 2000
    await c.previous()
    expect(cur()).toBe('1')
    expect(c.getState().queue.map((i) => i.track.nativeId)).toEqual(['2'])
  })

  it('restarts when there is no history', async () => {
    await c.playTracks([track(1), track(2)], 0)
    backend.position = 1000
    await c.previous()
    expect(cur()).toBe('1')
    expect(backend.position).toBe(0)
  })
})

describe('errors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('sets the error and skips to the next track after a delay', async () => {
    backend.broken.add('1')
    await c.playTracks([track(1), track(2)], 0)
    expect(c.getState().status).toBe('error')
    expect(c.getState().error).toBe('broken 1')
    expect(cur()).toBe('1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(cur()).toBe('2')
    expect(c.getState().status).toBe('playing')
    expect(c.getState().error).toBeUndefined()
  })

  it('does not skip past the last track', async () => {
    backend.broken.add('2')
    await c.playTracks([track(1), track(2)], 1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(cur()).toBe('2')
    expect(c.getState().status).toBe('error')
  })

  it('handles errors reported by the backend mid-playback', async () => {
    await c.playTracks([track(1), track(2)], 0)
    backend.emit({ type: 'error', message: 'decode failed' })
    expect(c.getState().error).toBe('decode failed')
    await vi.advanceTimersByTimeAsync(1000)
    expect(cur()).toBe('2')
  })

  it('never loops forever on an all-broken queue with repeat all', async () => {
    for (const n of ['1', '2', '3']) backend.broken.add(n)
    c.cycleRepeat() // all
    await c.playTracks([track(1), track(2), track(3)], 0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(backend.loads.length).toBe(3)
    expect(c.getState().status).toBe('error')
  })

  it('a user action cancels the pending skip', async () => {
    backend.broken.add('1')
    await c.playTracks([track(1), track(2), track(3)], 0)
    await c.playTracks([track(9)], 0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(cur()).toBe('9')
    expect(backend.loads).toEqual(['1', '9'])
  })

  it('reports tracks no backend can play, and skips them', async () => {
    await c.playTracks([track(1, 'spotify'), track(2)], 0)
    expect(c.getState().status).toBe('error')
    expect(c.getState().error).toMatch(/spotify/)
    await vi.advanceTimersByTimeAsync(1000)
    expect(cur()).toBe('2')
  })
})

describe('backends', () => {
  it('picks the backend via canPlay and stops the old one when switching', async () => {
    const other = new FakeBackend(['spotify'])
    const cc = createPlaybackController([backend, other], { storage: null })
    await cc.playTracks([track(1), track(2, 'spotify')], 0)
    expect(backend.loads).toEqual(['1'])
    await cc.next()
    expect(other.loads).toEqual(['2'])
    expect(backend.stops).toBe(1)
    // events from the inactive backend are ignored
    backend.emit({ type: 'ended' })
    await flush()
    expect(cc.getState().current?.track.nativeId).toBe('2')
    cc.dispose()
  })
})

describe('volume', () => {
  it('clamps to 0..1 and applies to backends', () => {
    c.setVolume(1.7)
    expect(c.getState().volume).toBe(1)
    expect(backend.volume).toBe(1)
    c.setVolume(-0.3)
    expect(c.getState().volume).toBe(0)
    c.setVolume(Number.NaN)
    expect(c.getState().volume).toBe(0)
    c.setVolume(0.25)
    expect(backend.volume).toBe(0.25)
  })

  it('persists and restores volume and muted', () => {
    c.setVolume(0.4)
    c.setMuted(true)
    expect(storage.getItem(VOLUME_KEY)).toBe('0.4')
    expect(storage.getItem(MUTED_KEY)).toBe('true')
    const b2 = new FakeBackend()
    const c2 = createPlaybackController([b2], { storage })
    expect(c2.getState().volume).toBe(0.4)
    expect(c2.getState().muted).toBe(true)
    expect(b2.volume).toBe(0.4)
    expect(b2.muted).toBe(true)
    c2.dispose()
  })

  it('ignores corrupt or throwing storage', () => {
    const bad = memoryStorage({ [VOLUME_KEY]: 'loud' })
    expect(createPlaybackController([], { storage: bad }).getState().volume).toBe(0.8)
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    } as unknown as Storage
    const c3 = createPlaybackController([], { storage: throwing })
    expect(() => c3.setVolume(0.5)).not.toThrow()
    expect(c3.getState().volume).toBe(0.5)
  })
})

describe('queue via controller', () => {
  it('playNext, addToQueue, move, remove, clear', async () => {
    await c.playTracks([track(1), track(2)], 0)
    c.addToQueue([track(3)])
    c.playNext([track('n')])
    const q = (): string[] => c.getState().queue.map((i) => i.track.nativeId)
    expect(q()).toEqual(['n', '2', '3'])
    c.moveInQueue(0, 2)
    expect(q()).toEqual(['2', '3', 'n'])
    c.removeFromQueue(c.getState().queue[1]!.uid)
    expect(q()).toEqual(['2', 'n'])
    c.clearQueue()
    expect(q()).toEqual([])
    expect(cur()).toBe('1')
  })
})

describe('unplayable tracks', () => {
  const blocked = (n: number, availability: Track['availability'] = 'blocked'): Track => ({
    ...track(n),
    availability
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('playTracks on an unplayable track starts the next playable one, without loading it', async () => {
    await c.playTracks([track(1), blocked(2), blocked(3, 'preview'), track(4)], 1)
    expect(cur()).toBe('4')
    expect(backend.loads).toEqual(['4'])
    expect(c.getState().status).toBe('playing')
    expect(c.getState().error).toBeUndefined()
    expect(states.some((s) => s.status === 'error')).toBe(false)
  })

  it('next skips unplayable tracks instantly', async () => {
    await c.playTracks([track(1), blocked(2, 'preview'), track(3)], 0)
    await c.next()
    expect(cur()).toBe('3')
    expect(backend.loads).toEqual(['1', '3'])
    expect(states.some((s) => s.current?.track.nativeId === '2')).toBe(false)
  })

  it('natural end skips unplayable tracks instantly', async () => {
    await c.playTracks([track(1), blocked(2), blocked(3), track(4)], 0)
    backend.emit({ type: 'ended' })
    await flush()
    expect(cur()).toBe('4')
    expect(backend.loads).toEqual(['1', '4'])
    expect(c.getState().status).toBe('playing')
  })

  it('stops at the end when only unplayable tracks are left', async () => {
    await c.playTracks([track(1), blocked(2)], 0)
    await c.next()
    expect(cur()).toBe('1')
    expect(c.getState().status).toBe('paused')
    expect(backend.loads).toEqual(['1'])
  })

  it('previous skips unplayable tracks backwards', async () => {
    await c.playTracks([track(1), blocked(2), track(3)], 0)
    await c.next()
    expect(cur()).toBe('3')
    await c.previous()
    expect(cur()).toBe('1')
    expect(backend.loads).toEqual(['1', '3', '1'])
  })

  it('previous restarts the current track when everything before it is unplayable', async () => {
    await c.playTracks([blocked(1), track(2)], 0)
    expect(cur()).toBe('2')
    backend.position = 1000
    await c.previous()
    expect(cur()).toBe('2')
    expect(backend.position).toBe(0)
    expect(backend.loads).toEqual(['2'])
  })

  it('all-unplayable context: error status and no backend load', async () => {
    c.cycleRepeat() // all: must not loop
    await c.playTracks([blocked(1), blocked(2, 'preview'), blocked(3)], 0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(c.getState().status).toBe('error')
    expect(c.getState().error).toBe(NONE_PLAYABLE_MESSAGE)
    expect(backend.loads).toEqual([])
  })

  it('DRM-only tracks are playable (Widevine) and go to the backend', async () => {
    await c.playTracks([blocked(1, 'drm'), track(2)], 0)
    expect(cur()).toBe('1')
    expect(backend.loads).toEqual(['1'])
  })

  it('error skips also pass over unplayable tracks', async () => {
    backend.broken.add('1')
    await c.playTracks([track(1), blocked(2), track(3)], 0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(cur()).toBe('3')
    expect(backend.loads).toEqual(['1', '3'])
  })
})

describe('restore', () => {
  it('puts back the queue paused at the saved position, then plays on request', async () => {
    const a = { uid: 'r1', track: track(1) }
    const b = { uid: 'r2', track: track(2) }
    await c.restore({
      current: a,
      queue: [b],
      positionMs: 42_000,
      volume: 0.3,
      muted: false,
      shuffle: false,
      repeat: 'all',
      savedAt: '2026-11-12T00:00:00Z'
    })
    const s = c.getState()
    expect(s.status).toBe('paused')
    expect(cur()).toBe('1')
    expect(s.queue.map((i) => i.uid)).toEqual(['r2'])
    expect(s.volume).toBe(0.3)
    expect(s.repeat).toBe('all')
    expect(backend.playing).toBe(false)
    expect(c.getPositionMs()).toBe(42_000)
    await c.play()
    expect(c.getState().status).toBe('playing')
  })

  it('does nothing once something is already loaded', async () => {
    await c.playTracks([track(5)], 0)
    await c.restore({
      current: { uid: 'x', track: track(9) },
      queue: [],
      positionMs: 0,
      volume: 1,
      muted: false,
      shuffle: false,
      repeat: 'off',
      savedAt: ''
    })
    expect(cur()).toBe('5')
  })
})
