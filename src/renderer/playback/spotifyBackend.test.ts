import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '@shared/ipc'
import type { Track } from '@shared/types'
import { isLoadAborted, type BackendEvent, type PlaybackBackend } from './backend'
import {
  createSpotifyBackend,
  MESSAGES,
  PLAYER_NAME,
  type SpotifyBackendDeps
} from './spotifyBackend'
import {
  createSdkLoader,
  SDK_SCRIPT_ERROR,
  SPOTIFY_SDK_URL,
  type SdkEnv,
  type SpotifyNamespace,
  type SpotifyPlaybackState,
  type SpotifyPlayerOptions,
  type SpotifyTrack
} from './spotifySdk'

function track(id: string, durationMs = 200_000): Track {
  return {
    id: `spotify:${id}`,
    provider: 'spotify',
    nativeId: id,
    title: `Track ${id}`,
    artists: ['A'],
    durationMs
  }
}

function sTrack(id: string): SpotifyTrack {
  return { id, uri: `spotify:track:${id}` }
}

function state(
  id: string,
  opts: {
    paused?: boolean
    position?: number
    duration?: number
    loading?: boolean
    prev?: string[]
    current?: SpotifyTrack | null
  } = {}
): SpotifyPlaybackState {
  return {
    paused: opts.paused ?? false,
    position: opts.position ?? 0,
    ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
    ...(opts.loading !== undefined ? { loading: opts.loading } : {}),
    track_window: {
      current_track: opts.current !== undefined ? opts.current : sTrack(id),
      previous_tracks: (opts.prev ?? []).map(sTrack),
      next_tracks: []
    }
  }
}

type Listener = (payload: unknown) => void

class FakePlayer {
  listeners = new Map<string, Listener[]>()
  calls: string[] = []
  volumes: number[] = []
  /** What connect() returns; a never-settling promise simulates the Dev Mode hang. */
  connectResult: () => Promise<boolean> = () => Promise.resolve(true)
  /** Fire `ready` after connect(). */
  autoReady = true
  /** pause() reports a paused state for the current track. */
  autoPause = true
  playingId: string | null = null
  position = 0
  currentState: SpotifyPlaybackState | null = null

  constructor(public options: SpotifyPlayerOptions) {}

  addListener(event: string, cb: Listener): boolean {
    const list = this.listeners.get(event) ?? []
    list.push(cb)
    this.listeners.set(event, list)
    return true
  }
  fire(event: string, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload)
  }
  connect(): Promise<boolean> {
    this.calls.push('connect')
    if (this.autoReady) queueMicrotask(() => this.fire('ready', { device_id: 'dev1' }))
    return this.connectResult()
  }
  disconnect(): void {
    this.calls.push('disconnect')
  }
  getCurrentState(): Promise<SpotifyPlaybackState | null> {
    this.calls.push('getCurrentState')
    return Promise.resolve(this.currentState)
  }
  async setVolume(v: number): Promise<void> {
    this.volumes.push(v)
  }
  async pause(): Promise<void> {
    this.calls.push('pause')
    if (this.autoPause && this.playingId) {
      const id = this.playingId
      queueMicrotask(() =>
        this.fire('player_state_changed', state(id, { paused: true, position: this.position }))
      )
    }
  }
  async resume(): Promise<void> {
    this.calls.push('resume')
  }
  async seek(ms: number): Promise<void> {
    this.calls.push(`seek:${ms}`)
  }
  async activateElement(): Promise<void> {
    this.calls.push('activateElement')
  }
}

interface Harness {
  backend: PlaybackBackend
  events: BackendEvent[]
  players: FakePlayer[]
  player: () => FakePlayer
  loadSdk: ReturnType<typeof vi.fn>
  invokes: unknown[][]
  /** spotify:play starts the track (fires a playing state). */
  autoStart: { value: boolean }
  playError: { value: Error | null }
  advanceClock: (ms: number) => void
}

let clock = 0

function setup(
  overrides: Partial<SpotifyBackendDeps> = {},
  configure: (p: FakePlayer, index: number) => void = () => {}
): Harness {
  const players: FakePlayer[] = []
  const invokes: unknown[][] = []
  const autoStart = { value: true }
  const playError: { value: Error | null } = { value: null }
  const sdk: SpotifyNamespace = {
    Player: class {
      constructor(opts: SpotifyPlayerOptions) {
        const p = new FakePlayer(opts)
        configure(p, players.length)
        players.push(p)
        return p as unknown as object
      }
    } as unknown as SpotifyNamespace['Player']
  }
  const loadSdk = vi.fn(() => Promise.resolve(sdk))
  const invoke = ((channel: string, ...args: unknown[]) => {
    invokes.push([channel, ...args])
    if (channel === 'spotify:getAccessToken') return Promise.resolve('token-1')
    if (channel === 'spotify:play') {
      if (playError.value) return Promise.reject(playError.value)
      const p = players[players.length - 1]!
      const [, ids, pos] = args as [string, string[], number]
      p.playingId = ids[0]!
      p.position = pos
      if (autoStart.value) {
        queueMicrotask(() =>
          p.fire('player_state_changed', state(ids[0]!, { paused: false, position: pos }))
        )
      }
      return Promise.resolve()
    }
    return Promise.reject(new Error(`unexpected ${channel}`))
  }) as Api['invoke']
  const backend = createSpotifyBackend({
    loadSdk,
    invoke,
    now: () => clock,
    ...overrides
  })
  const events: BackendEvent[] = []
  backend.on((e) => events.push(e))
  return {
    backend,
    events,
    players,
    player: () => players[players.length - 1]!,
    loadSdk,
    invokes,
    autoStart,
    playError,
    advanceClock: (ms) => {
      clock += ms
    }
  }
}

/** Run queued microtasks (the fake SDK answers through queueMicrotask). */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

/** Load a track and let the fake SDK run through connect/start/pause. */
async function loaded(h: Harness, t: Track, startMs?: number): Promise<void> {
  const p = h.backend.load(t, startMs)
  await flush()
  await p
}

beforeEach(() => {
  vi.useFakeTimers()
  clock = 1_000_000
})
afterEach(() => {
  vi.useRealTimers()
})

describe('spotify backend', () => {
  it('only plays Spotify tracks', () => {
    const { backend } = setup()
    expect(backend.canPlay(track('a'))).toBe(true)
    expect(backend.canPlay({ ...track('a'), provider: 'local' })).toBe(false)
    expect(backend.canPlay({ ...track('a'), provider: 'soundcloud' })).toBe(false)
  })

  it('does not load the SDK until the first load', async () => {
    const h = setup()
    h.backend.setVolume(0.5, false)
    h.backend.pause()
    h.backend.seek(100)
    await h.backend.play()
    h.backend.stop()
    expect(h.backend.getPositionMs()).toBe(0)
    expect(h.loadSdk).not.toHaveBeenCalled()
    await loaded(h, track('a'))
    await loaded(h, track('b'))
    expect(h.loadSdk).toHaveBeenCalledTimes(1)
    expect(h.players).toHaveLength(1)
    expect(h.player().calls.filter((c) => c === 'connect')).toHaveLength(1)
  })

  it('creates the player with the app name, volume and no media session', async () => {
    const h = setup()
    h.backend.setVolume(0.4, false)
    await loaded(h, track('a'))
    const opts = h.player().options
    expect(opts.name).toBe(PLAYER_NAME)
    expect(opts.enableMediaSession).toBe(false)
    expect(opts.volume).toBe(0.4)
    const cb = vi.fn()
    opts.getOAuthToken(cb)
    await flush()
    expect(cb).toHaveBeenCalledWith('token-1')
  })

  it('plays one URI on the device, waits for it to start, then leaves it paused', async () => {
    const h = setup()
    h.autoStart.value = false
    h.backend.setVolume(0.7, false)
    let done = false
    const p = h.backend.load(track('abc'), 5000).then(() => {
      done = true
    })
    await flush()
    expect(h.invokes).toContainEqual(['spotify:play', 'dev1', ['abc'], 5000])
    const pl = h.player()
    // Muted while the track starts.
    expect(pl.volumes[pl.volumes.length - 1]).toBe(0)
    // A state for some other track does not count.
    pl.fire('player_state_changed', state('zzz', { position: 0 }))
    // Nor does a paused one for ours.
    pl.fire('player_state_changed', state('abc', { paused: true, position: 5000 }))
    await flush()
    expect(done).toBe(false)
    expect(pl.calls).not.toContain('pause')
    pl.fire('player_state_changed', state('abc', { position: 5000, duration: 180_000 }))
    await flush()
    await p
    expect(done).toBe(true)
    expect(pl.calls).toContain('pause')
    expect(pl.volumes[pl.volumes.length - 1]).toBe(0.7)
    expect(h.backend.getPositionMs()).toBe(5000)
    expect(h.backend.getDurationMs()).toBe(180_000)
    // load() reports no playing/paused events of its own.
    expect(h.events).toEqual([])
  })

  it('matches by URI or relinked id', async () => {
    const h = setup()
    h.autoStart.value = false
    const p = h.backend.load(track('abc'))
    await flush()
    h.player().fire(
      'player_state_changed',
      state('x', {
        current: {
          id: 'relinked',
          uri: 'spotify:track:relinked',
          linked_from: { id: 'abc', uri: null }
        }
      })
    )
    await flush()
    await expect(p).resolves.toBeUndefined()
  })

  it('a newer load aborts an older pending one', async () => {
    const h = setup()
    h.autoStart.value = false
    const first = h.backend.load(track('a'))
    await flush()
    h.autoStart.value = true
    const second = h.backend.load(track('b'))
    const firstErr = await first.catch((e: unknown) => e)
    expect(isLoadAborted(firstErr)).toBe(true)
    // A late start of the old track must not resolve the new load early.
    h.player().fire('player_state_changed', state('a'))
    await flush()
    await second
    expect(h.invokes.filter((c) => c[0] === 'spotify:play').map((c) => c[2])).toEqual([
      ['a'],
      ['b']
    ])
  })

  it('stop() aborts a pending load and keeps the connection', async () => {
    const h = setup()
    h.autoStart.value = false
    const p = h.backend.load(track('a'))
    await flush()
    h.backend.stop()
    expect(isLoadAborted(await p.catch((e: unknown) => e))).toBe(true)
    expect(h.player().calls).toContain('pause')
    expect(h.player().calls).not.toContain('disconnect')
    expect(h.backend.getPositionMs()).toBe(0)
    expect(h.backend.getDurationMs()).toBe(0)
  })

  it('pauses a start that lands after stop() (skip to another source mid-load)', async () => {
    const h = setup()
    h.autoStart.value = false
    const p = h.backend.load(track('a'), 0, { autoplay: true })
    await flush()
    h.backend.stop()
    await p.catch(() => undefined)
    const pausesBefore = h.player().calls.filter((c) => c === 'pause').length
    // Spotify starts the track that was already requested.
    h.player().fire('player_state_changed', state('a', { paused: false, position: 0 }))
    await flush()
    expect(h.player().calls.filter((c) => c === 'pause').length).toBe(pausesBefore + 1)
    expect(h.events).toEqual([])
  })

  it('rejects with the IPC error when spotify:play fails, without an error event', async () => {
    const h = setup()
    h.playError.value = new Error(
      "Error invoking remote method 'spotify:play': Error: No active Spotify login."
    )
    await expect(h.backend.load(track('a'))).rejects.toThrow(/^No active Spotify login\.$/)
    expect(h.events).toEqual([])
  })

  it('interpolates position while playing and clamps to the duration', async () => {
    const h = setup()
    await loaded(h, track('a', 10_000))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 1000, duration: 10_000 }))
    expect(h.backend.getPositionMs()).toBe(1000)
    h.advanceClock(500)
    expect(h.backend.getPositionMs()).toBe(1500)
    h.advanceClock(60_000)
    expect(h.backend.getPositionMs()).toBe(10_000)
    pl.fire('player_state_changed', state('a', { paused: true, position: 4000, duration: 10_000 }))
    h.advanceClock(1000)
    expect(h.backend.getPositionMs()).toBe(4000)
  })

  it('resyncs with getCurrentState() every few seconds while playing, not every frame', async () => {
    const h = setup({ resyncMs: 5000 })
    await loaded(h, track('a'))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 0 }))
    pl.currentState = state('a', { position: 4900 })
    for (let i = 0; i < 100; i++) h.backend.getPositionMs()
    expect(pl.calls.filter((c) => c === 'getCurrentState')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(pl.calls.filter((c) => c === 'getCurrentState')).toHaveLength(1)
    expect(h.backend.getPositionMs()).toBe(4900)
  })

  it('falls back to track duration_ms, then Track.durationMs', async () => {
    const h = setup()
    await loaded(h, track('a', 123_000))
    expect(h.backend.getDurationMs()).toBe(123_000)
    h.player().fire(
      'player_state_changed',
      state('a', { current: { ...sTrack('a'), duration_ms: 99_000 } })
    )
    expect(h.backend.getDurationMs()).toBe(99_000)
    expect(h.events).toContainEqual({ type: 'duration', durationMs: 99_000 })
  })

  it('maps paused flips and loading to playing/paused/waiting', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { loading: true }))
    pl.fire('player_state_changed', state('a', { loading: false, position: 10 }))
    pl.fire('player_state_changed', state('a', { position: 20 }))
    pl.fire('player_state_changed', state('a', { paused: true, position: 30 }))
    pl.fire('player_state_changed', state('a', { paused: true, position: 30 }))
    expect(h.events.filter((e) => e.type !== 'duration')).toEqual([
      { type: 'waiting' },
      { type: 'playing' },
      { type: 'paused' }
    ])
  })

  it('fires ended exactly once when the track finishes', async () => {
    const h = setup()
    await loaded(h, track('a', 10_000))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 9000, duration: 10_000 }))
    h.advanceClock(1000)
    pl.fire('player_state_changed', state('a', { paused: true, position: 0, prev: ['a'] }))
    pl.fire('player_state_changed', state('a', { paused: true, position: 0, prev: ['a'] }))
    pl.fire('player_state_changed', state('', { paused: true, position: 0, current: null }))
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1)
    expect(h.events.filter((e) => e.type === 'paused')).toHaveLength(0)
    expect(h.backend.getPositionMs()).toBe(0)
  })

  it('fires ended when playing near the end comes back paused at 0', async () => {
    const h = setup()
    await loaded(h, track('a', 10_000))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 8000, duration: 10_000 }))
    h.advanceClock(1500)
    pl.fire('player_state_changed', state('a', { paused: true, position: 0 }))
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1)
  })

  it('does not treat a mid-track pause at 0 as ended', async () => {
    const h = setup()
    await loaded(h, track('a', 100_000))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 1000 }))
    pl.fire('player_state_changed', state('a', { paused: true, position: 0 }))
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(0)
  })

  it('fires ended and pauses when Spotify moves on to another track', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    pl.calls.length = 0
    pl.fire('player_state_changed', state('a', { position: 1000 }))
    pl.fire('player_state_changed', state('radio', { position: 0, prev: ['a'] }))
    pl.fire('player_state_changed', state('radio', { position: 500 }))
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1)
    expect(pl.calls).toContain('pause')
  })

  it('play() after ended restarts the track on the device', async () => {
    const h = setup()
    await loaded(h, track('a', 10_000))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { paused: true, position: 0, prev: ['a'] }))
    expect(h.events).toContainEqual({ type: 'ended' })
    h.backend.seek(0)
    await h.backend.play()
    expect(h.invokes.filter((c) => c[0] === 'spotify:play')).toHaveLength(2)
    expect(pl.calls).not.toContain('resume')
  })

  it('play() resumes, calling activateElement() once; pause/seek go to the SDK', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    await h.backend.play()
    await h.backend.play()
    h.backend.pause()
    h.backend.seek(42_000)
    expect(pl.calls.filter((c) => c === 'activateElement')).toHaveLength(1)
    // The second play() is a no-op: the track is already playing.
    expect(pl.calls.filter((c) => c === 'resume')).toHaveLength(1)
    expect(pl.calls).toContain('seek:42000')
    expect(h.backend.getPositionMs()).toBe(42_000)
  })

  it('setVolume applies to the SDK, muted means 0', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    h.backend.setVolume(0.3, false)
    h.backend.setVolume(0.3, true)
    expect(pl.volumes.slice(-2)).toEqual([0.3, 0])
  })

  it('maps SDK errors during a load to a rejection (no error event)', async () => {
    const h = setup()
    h.autoStart.value = false
    const p = h.backend.load(track('a'))
    await flush()
    h.player().fire('account_error', { message: 'premium' })
    await expect(p).rejects.toThrow(MESSAGES.premium)
    expect(MESSAGES.premium).toBe('Spotify Premium is required to play Spotify tracks.')
    expect(h.events).toEqual([])
  })

  it('maps SDK errors after a load to error events', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    pl.fire('playback_error', { message: 'x' })
    pl.fire('authentication_error', { message: 'x' })
    pl.fire('initialization_error', { message: 'no EME' })
    expect(h.events).toEqual([
      { type: 'error', message: MESSAGES.playback },
      { type: 'error', message: MESSAGES.authentication },
      { type: 'error', message: `${MESSAGES.initialization} (no EME)` }
    ])
    expect(MESSAGES.playback).toMatch(/npm run vmp:sign/)
  })

  it('reports autoplay_failed as paused', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    pl.fire('player_state_changed', state('a', { position: 100 }))
    pl.fire('autoplay_failed')
    expect(h.events.filter((e) => e.type !== 'duration')).toEqual([
      { type: 'playing' },
      { type: 'paused' }
    ])
  })

  it('an SDK error during connect rejects the load; the next load starts a fresh player', async () => {
    const h = setup({}, (p, i) => {
      if (i > 0) return
      p.autoReady = false
      p.connectResult = () => new Promise(() => {})
    })
    const p = h.backend.load(track('a'))
    const err = p.catch((e: unknown) => e)
    await flush()
    const first = h.player()
    first.fire('authentication_error', { message: 'bad token' })
    expect(((await err) as Error).message).toBe(MESSAGES.authentication)
    expect(first.calls).toContain('disconnect')
    await loaded(h, track('a'))
    expect(h.players).toHaveLength(2)
    expect(h.events).toEqual([])
  })

  it('times out a hanging connect()', async () => {
    const h = setup({ connectTimeoutMs: 1000 }, (p) => {
      p.autoReady = false
      p.connectResult = () => new Promise(() => {})
    })
    const err = h.backend.load(track('a')).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(((await err) as Error).message).toBe(MESSAGES.connectTimeout)
  })

  it('times out when ready never fires', async () => {
    const h = setup({ readyTimeoutMs: 1000 }, (p) => {
      p.autoReady = false
    })
    const err = h.backend.load(track('a')).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(((await err) as Error).message).toBe(MESSAGES.readyTimeout)
  })

  it('times out when the track never starts, and pauses it', async () => {
    const h = setup({ startTimeoutMs: 1000 })
    h.autoStart.value = false
    const err = h.backend.load(track('a')).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(((await err) as Error).message).toBe(MESSAGES.startTimeout)
    expect(h.player().calls).toContain('pause')
    expect(h.events).toEqual([])
  })

  it('re-waits for ready after not_ready', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    pl.fire('not_ready', { device_id: 'dev1' })
    await loaded(h, track('b'))
    expect(pl.calls.filter((c) => c === 'connect')).toHaveLength(2)
    expect(h.players).toHaveLength(1)
  })
})

describe('sdk loader', () => {
  function fakeEnv(): {
    env: SdkEnv
    appended: { src: string; onerror?: () => void }[]
    win: SdkEnv['window']
  } {
    const appended: { src: string; onerror?: () => void }[] = []
    const win: SdkEnv['window'] = {}
    const env: SdkEnv = {
      window: win,
      document: {
        createElement: () => ({}) as HTMLScriptElement,
        querySelector: () => null,
        head: {
          appendChild: (node: HTMLScriptElement) => {
            appended.push(node as unknown as { src: string })
            return node
          }
        }
      }
    }
    return { env, appended, win }
  }

  it('injects the script once, with the ready callback defined first', async () => {
    const { env, appended, win } = fakeEnv()
    const load = createSdkLoader(() => env)
    const a = load()
    const b = load()
    expect(appended).toHaveLength(1)
    expect(appended[0]!.src).toBe(SPOTIFY_SDK_URL)
    expect(typeof win.onSpotifyWebPlaybackSDKReady).toBe('function')
    const ns = { Player: class {} } as unknown as SpotifyNamespace
    win.Spotify = ns
    win.onSpotifyWebPlaybackSDKReady!()
    await expect(a).resolves.toBe(ns)
    await expect(b).resolves.toBe(ns)
    await expect(load()).resolves.toBe(ns)
    expect(appended).toHaveLength(1)
  })

  it('forgets a failed load so the next call retries', async () => {
    const { env, appended } = fakeEnv()
    const load = createSdkLoader(() => env)
    const a = load()
    appended[0]!.onerror!()
    await expect(a).rejects.toThrow(SDK_SCRIPT_ERROR)
    void load().catch(() => {})
    expect(appended).toHaveLength(2)
  })

  it('rejects without a DOM', async () => {
    await expect(createSdkLoader(() => null)()).rejects.toThrow(/browser window/)
  })
})

describe('fast start, resume sync and gapless hand-off', () => {
  const playIds = (h: Harness): string[][] =>
    h.invokes.filter((c) => c[0] === 'spotify:play').map((c) => c[2] as string[])

  it('autoplay load keeps the track playing: no mute, no pause, play() is a no-op', async () => {
    const h = setup()
    const p = h.backend.load(track('a'), 0, { autoplay: true })
    await flush()
    await p
    const pl = h.player()
    expect(pl.calls).not.toContain('pause')
    expect(pl.volumes).not.toContain(0)
    await h.backend.play()
    expect(pl.calls).not.toContain('resume')
    h.advanceClock(3_000)
    expect(h.backend.getPositionMs()).toBe(3_000)
  })

  it('sends the following run of Spotify tracks so Spotify can continue by itself', async () => {
    const h = setup()
    const local: Track = { ...track('L'), provider: 'local', id: 'local:L' }
    const p = h.backend.load(track('a'), 0, {
      autoplay: true,
      upcoming: [track('b'), track('c'), local, track('d')]
    })
    await flush()
    await p
    expect(playIds(h)).toEqual([['a', 'b', 'c']])
  })

  it('adopts the next track Spotify advanced to without a new play request', async () => {
    const h = setup()
    const p = h.backend.load(track('a'), 0, { autoplay: true, upcoming: [track('b')] })
    await flush()
    await p
    const pl = h.player()
    pl.fire('player_state_changed', state('b', { paused: false, position: 0, prev: ['a'] }))
    expect(h.events).toContainEqual({ type: 'ended' })
    expect(pl.calls).not.toContain('pause')
    h.advanceClock(500)
    await h.backend.load(track('b'), 0, { autoplay: true })
    expect(playIds(h)).toHaveLength(1)
    expect(h.backend.getPositionMs()).toBe(500)
    h.advanceClock(1_000)
    expect(h.backend.getPositionMs()).toBe(1_500)
  })

  it('pauses a track Spotify moved to that is not in our context', async () => {
    const h = setup()
    const p = h.backend.load(track('a'), 0, { autoplay: true, upcoming: [track('b')] })
    await flush()
    await p
    const pl = h.player()
    pl.fire('player_state_changed', state('radio', { paused: false }))
    expect(h.events).toContainEqual({ type: 'ended' })
    expect(pl.calls).toContain('pause')
  })

  it('ignores a stale paused state right after resume and confirms with Spotify', async () => {
    const h = setup()
    await loaded(h, track('a'))
    const pl = h.player()
    await h.backend.play()
    h.events.length = 0
    // A late "paused" from the load's pause arrives after our resume.
    pl.fire('player_state_changed', state('a', { paused: true, position: 0 }))
    expect(h.events).not.toContainEqual({ type: 'paused' })
    h.advanceClock(1_000)
    expect(h.backend.getPositionMs()).toBe(1_000)
    // The check asks Spotify, which says it's playing.
    pl.currentState = state('a', { paused: false, position: 1_000 })
    await vi.advanceTimersByTimeAsync(700)
    expect(pl.calls).toContain('getCurrentState')
    h.advanceClock(2_000)
    expect(h.backend.getPositionMs()).toBe(3_000)
  })
})
