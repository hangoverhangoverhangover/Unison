import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FindResult } from '@shared/match'
import type { PlaybackState, RepeatMode } from '@shared/playback'
import type {
  JamCapabilities,
  JamCommand,
  JamEntry,
  JamRoomState,
  JamStatus,
  JamTrack,
  JamUnplayable
} from '@shared/jam'
import type { Track } from '@shared/types'
import { fromJamTrack, toJamTrack } from '@shared/jam'
import {
  bindJamSync,
  DRIFT_MS,
  LOCAL_FILE_NOTICE,
  type JamSyncController,
  type JamSyncReport
} from './jamSync'

// ---------------------------------------------------------------------------------------
// Fakes

function fakeController(): {
  c: JamSyncController
  fake: {
    calls: string[]
    position: number
    broken: Map<string, string>
    end(): void
    endPauseFirst(): void
    setLocal(p: Partial<PlaybackState>): void
  }
} {
  let state: PlaybackState = {
    status: 'idle',
    current: null,
    queue: [],
    positionMs: 0,
    durationMs: 0,
    volume: 1,
    muted: false,
    shuffle: false,
    repeat: 'all'
  }
  let wantPlay = false
  let ends = 0
  const listeners = new Set<(s: PlaybackState) => void>()
  const emit = (p: Partial<PlaybackState>): void => {
    state = { ...state, ...p }
    for (const l of [...listeners]) l(state)
  }
  const fake = {
    calls: [] as string[],
    position: 0,
    broken: new Map<string, string>(),
    /** The track reached its end (what the real controller does with a one-track queue). */
    end(): void {
      fake.position = 0
      wantPlay = false
      emit({ status: 'paused', positionMs: 0, endedAt: ++ends })
    },
    /**
     * What a real <audio> element does at the end: a 'pause' event first (the
     * controller reports paused mid-position), then 'ended' (paused at 0).
     */
    /** Set what the local player shows (before a Jam starts). */
    setLocal(p: Partial<PlaybackState>): void {
      emit(p)
    },
    endPauseFirst(): void {
      wantPlay = false
      emit({ status: 'paused', positionMs: fake.position })
      fake.position = 0
      emit({ status: 'paused', positionMs: 0, endedAt: ++ends })
    }
  }
  const c: JamSyncController = {
    async playTracks(tracks, i) {
      const track = tracks[i]!
      fake.calls.push(`load ${track.id}`)
      wantPlay = true
      fake.position = 0
      emit({
        current: { uid: track.id, track },
        status: 'loading',
        positionMs: 0,
        durationMs: track.durationMs,
        error: undefined
      })
      await Promise.resolve()
      const err = fake.broken.get(track.id)
      if (err) emit({ status: 'error', error: err })
      else emit({ status: wantPlay ? 'playing' : 'paused' })
    },
    async play() {
      fake.calls.push('play')
      wantPlay = true
      if (state.status !== 'loading') emit({ status: 'playing' })
    },
    pause() {
      fake.calls.push('pause')
      wantPlay = false
      if (state.status === 'playing') emit({ status: 'paused', positionMs: fake.position })
    },
    async toggle() {
      fake.calls.push('toggle')
    },
    seek(ms) {
      fake.calls.push(`seek ${ms}`)
      fake.position = ms
    },
    async next() {
      fake.calls.push('next')
    },
    async previous() {
      fake.calls.push('previous')
    },
    playNext() {
      fake.calls.push('playNext')
    },
    addToQueue() {
      fake.calls.push('addToQueue')
    },
    cycleRepeat() {
      const order: RepeatMode[] = ['off', 'all', 'one']
      emit({ repeat: order[(order.indexOf(state.repeat) + 1) % 3]! })
    },
    async restore() {
      fake.calls.push('restore')
    },
    getPositionMs: () => fake.position,
    getState: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
  return { c, fake }
}

const jt = (id: string, provider: 'spotify' | 'soundcloud' = 'soundcloud'): JamTrack => ({
  id: `${provider}:${id}`,
  provider,
  nativeId: id,
  title: `Song ${id}`,
  artists: ['A'],
  durationMs: 180_000
})
const entry = (n: number, provider: 'spotify' | 'soundcloud' = 'soundcloud'): JamEntry => ({
  entryId: `e${n}`,
  track: jt(String(n), provider),
  addedBy: 'p1'
})

const OFFSET = 1000
let clock: number
let tick: () => void
let status: JamStatus
let statusListeners: Set<(s: JamStatus) => void>
let capsListeners: Set<() => void>
let prefListeners: Set<() => void>
let caps: JamCapabilities
let pref: JamUnplayable
let report: JamSyncReport
let send: ReturnType<typeof vi.fn<(c: JamCommand) => Promise<void>>>
let setCapabilities: ReturnType<typeof vi.fn<(c: JamCapabilities) => void>>
let findOn: ReturnType<typeof vi.fn<(t: Track, s: 'spotify' | 'soundcloud') => Promise<FindResult>>>
let ctl: ReturnType<typeof fakeController>
let unbind: () => void

const relayNow = (): number => clock + OFFSET
const room = (extra: Partial<JamRoomState> = {}): JamRoomState => ({
  code: 'K7Q2MX',
  participants: [],
  queue: [entry(1), entry(2)],
  currentIndex: 0,
  playing: true,
  positionMs: 10_000,
  positionAt: relayNow() - 5000,
  blockUnplayable: false,
  version: 1,
  ...extra
})
const setStatus = (s: Partial<JamStatus>): void => {
  status = { state: 'connected', role: 'guest', you: 'p2', clockOffsetMs: OFFSET, ...s }
  for (const l of [...statusListeners]) l(status)
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const sent = (): JamCommand[] => send.mock.calls.map((c) => c[0])

beforeEach(() => {
  clock = 5_000_000
  status = { state: 'off', clockOffsetMs: 0 }
  statusListeners = new Set()
  capsListeners = new Set()
  prefListeners = new Set()
  caps = { spotify: false, soundcloud: true }
  pref = 'match'
  report = { substitute: null, skipped: null, notice: null }
  send = vi.fn(async () => undefined)
  setCapabilities = vi.fn()
  findOn = vi.fn(async (_t, service) => ({ service, matches: [] }))
  ctl = fakeController()
  unbind = bindJamSync(ctl.c, {
    getStatus: () => status,
    subscribeStatus: (l) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    },
    send,
    setCapabilities,
    findOn,
    getCapabilities: () => caps,
    subscribeCapabilities: (l) => {
      capsListeners.add(l)
      return () => capsListeners.delete(l)
    },
    getUnplayable: () => pref,
    subscribeUnplayable: (l) => {
      prefListeners.add(l)
      return () => prefListeners.delete(l)
    },
    report: (p) => {
      report = { ...report, ...p }
    },
    now: () => clock,
    setInterval: (fn) => {
      tick = fn
      return 1
    },
    clearInterval: () => undefined
  })
})

// ---------------------------------------------------------------------------------------

describe('following the room', () => {
  it('loads the current entry alone at the room position, playing', async () => {
    setStatus({ room: room() })
    await flush()
    expect(ctl.fake.calls).toEqual(['pause', 'load soundcloud:1', 'seek 15000'])
    expect(ctl.c.getState().status).toBe('playing')
    // Repeat is forced off for the Jam.
    expect(ctl.c.getState().repeat).toBe('off')
  })

  it('loads paused when the room is paused', async () => {
    setStatus({ room: room({ playing: false, positionMs: 30_000 }) })
    await flush()
    expect(ctl.fake.calls).toEqual(['pause', 'load soundcloud:1', 'pause', 'seek 30000'])
    expect(ctl.c.getState().status).toBe('paused')
  })

  it('loads the next entry when the room moves on', async () => {
    setStatus({ room: room() })
    await flush()
    setStatus({
      room: room({ currentIndex: 1, positionMs: 0, positionAt: relayNow(), version: 2 })
    })
    await flush()
    expect(ctl.fake.calls).toContain('load soundcloud:2')
  })

  it('seeks only when drift is over the threshold', async () => {
    setStatus({ room: room() })
    await flush()
    ctl.fake.calls = []
    // Local playback stalled at 15000 while the room went on.
    clock += DRIFT_MS
    tick()
    expect(ctl.fake.calls).toEqual([])
    clock += 1
    tick()
    expect(ctl.fake.calls).toEqual([`seek ${15_000 + DRIFT_MS + 1}`])
  })

  it('mirrors play and pause', async () => {
    setStatus({ room: room() })
    await flush()
    ctl.fake.calls = []
    ctl.fake.position = 15_000
    setStatus({ room: room({ playing: false, positionMs: 15_000, version: 2 }) })
    expect(ctl.fake.calls).toEqual(['pause'])
    setStatus({ room: room({ playing: true, positionMs: 15_000, positionAt: relayNow() }) })
    expect(ctl.fake.calls).toEqual(['pause', 'play'])
  })

  it('stays put while reconnecting', async () => {
    setStatus({ room: room() })
    await flush()
    ctl.fake.calls = []
    setStatus({ state: 'reconnecting', room: room({ playing: false }) })
    clock += 10_000
    tick()
    expect(ctl.fake.calls).toEqual([])
  })
})

describe('end of a track', () => {
  it('the host reports ended when the player pauses just before the end (auto-advance)', async () => {
    setStatus({ role: 'host', room: room() })
    await flush()
    ctl.fake.position = 179_000
    ctl.fake.endPauseFirst()
    expect(sent()).toEqual([{ type: 'ended', entryId: 'e1' }])
  })

  it('the host reports ended once; a guest just waits', async () => {
    setStatus({ role: 'host', room: room() })
    await flush()
    ctl.fake.end()
    ctl.fake.end()
    expect(sent()).toEqual([{ type: 'ended', entryId: 'e1' }])
  })

  it("guests don't report and don't restart the finished track", async () => {
    setStatus({ room: room() })
    await flush()
    clock += 170_000
    ctl.fake.position = 179_000
    ctl.fake.end()
    ctl.fake.calls = []
    tick()
    expect(sent()).toEqual([])
    expect(ctl.fake.calls).toEqual([])
  })
})

describe('local controls during a Jam', () => {
  it('host transport becomes room commands, media keys included', async () => {
    setStatus({ role: 'host', room: room() })
    await flush()
    ctl.fake.position = 20_000
    await ctl.c.toggle()
    ctl.c.seek(42_000)
    await ctl.c.next()
    await ctl.c.previous() // past 3 s: restart
    ctl.fake.position = 1000
    await ctl.c.previous()
    expect(sent()).toEqual([
      { type: 'pause', positionMs: 20_000 },
      { type: 'seek', positionMs: 42_000 },
      { type: 'next' },
      { type: 'seek', positionMs: 0 },
      { type: 'previous' }
    ])
    expect(ctl.fake.calls).not.toContain('next')
    expect(ctl.fake.calls).not.toContain('previous')
  })

  it('guest transport does nothing', async () => {
    setStatus({ room: room() })
    await flush()
    ctl.fake.calls = []
    await ctl.c.toggle()
    ctl.c.pause()
    ctl.c.seek(1)
    await ctl.c.next()
    await ctl.c.previous()
    expect(sent()).toEqual([])
    expect(ctl.fake.calls).toEqual([])
  })

  it('playing or queueing tracks adds them to the Jam; local files are refused', async () => {
    setStatus({ room: room() })
    await flush()
    const sc: Track = { ...jt('9'), album: 'x' }
    const local: Track = { ...jt('8'), id: 'local:8', provider: 'local', localPath: 'C:\\a.mp3' }
    await ctl.c.playTracks([local, sc], 1)
    ctl.c.addToQueue([local, sc])
    expect(sent()).toEqual([
      { type: 'add', tracks: [jt('9')] },
      { type: 'add', tracks: [jt('9')] }
    ])
    expect(report.notice).toBe(LOCAL_FILE_NOTICE)
    expect(ctl.fake.calls).not.toContain('addToQueue')
  })
})

describe("tracks you can't play", () => {
  it("'match' plays the other service's best match and says so", async () => {
    const sub: Track = { ...jt('s1'), title: 'Song 1 (SC)' }
    findOn.mockResolvedValueOnce({
      service: 'soundcloud',
      matches: [{ track: sub, reason: 'isrc' }]
    })
    setStatus({ room: room({ queue: [entry(1, 'spotify')] }) })
    await flush()
    expect(findOn).toHaveBeenCalledWith(expect.objectContaining({ id: 'spotify:1' }), 'soundcloud')
    expect(ctl.fake.calls).toContain('load soundcloud:s1')
    expect(ctl.fake.calls).not.toContain('load spotify:1')
    expect(report.substitute).toMatchObject({ entryId: 'e1', track: sub })
    expect(report.substitute?.reason).toContain('SoundCloud version')
  })

  it("'match' with no match falls back to skipping", async () => {
    setStatus({ room: room({ queue: [entry(1, 'spotify')] }) })
    await flush()
    expect(report.skipped).toMatchObject({ entryId: 'e1' })
    expect(report.skipped?.reason).toContain('No match')
  })

  it("'skip' stays silent until the next entry", async () => {
    pref = 'skip'
    setStatus({ room: room({ queue: [entry(1, 'spotify'), entry(2)] }) })
    await flush()
    expect(findOn).not.toHaveBeenCalled()
    expect(ctl.fake.calls).toEqual(['pause', 'pause'])
    expect(report.skipped?.reason).toContain("can't play Spotify")
    setStatus({ room: room({ queue: [entry(1, 'spotify'), entry(2)], currentIndex: 1 }) })
    await flush()
    expect(report.skipped).toBeNull()
    expect(ctl.fake.calls).toContain('load soundcloud:2')
  })

  it('a failed load is treated as unplayable', async () => {
    pref = 'skip'
    ctl.fake.broken.set('soundcloud:1', 'Track not available.')
    setStatus({ room: room() })
    await flush()
    expect(report.skipped).toMatchObject({ entryId: 'e1', reason: 'Track not available.' })
  })

  it("a host that skips ends the entry on the room's clock", async () => {
    pref = 'skip'
    setStatus({ role: 'host', room: room({ queue: [entry(1, 'spotify')] }) })
    await flush()
    tick()
    expect(sent()).not.toContainEqual({ type: 'ended', entryId: 'e1' })
    clock += 180_000
    tick()
    tick()
    expect(sent().filter((c) => c.type === 'ended')).toEqual([{ type: 'ended', entryId: 'e1' }])
  })
})

describe('capabilities and block setting', () => {
  it('reports capabilities on start and on change, and drops Spotify after a Premium error', async () => {
    await flush()
    expect(setCapabilities).toHaveBeenLastCalledWith({ spotify: false, soundcloud: true })
    caps = { spotify: true, soundcloud: true }
    capsListeners.forEach((l) => l())
    await flush()
    expect(setCapabilities).toHaveBeenLastCalledWith({ spotify: true, soundcloud: true })
    const n = setCapabilities.mock.calls.length
    capsListeners.forEach((l) => l())
    await flush()
    expect(setCapabilities).toHaveBeenCalledTimes(n)

    pref = 'skip'
    ctl.fake.broken.set('spotify:1', 'Spotify Premium is required to play Spotify tracks.')
    setStatus({ room: room({ queue: [entry(1, 'spotify')] }) })
    await flush()
    expect(setCapabilities).toHaveBeenLastCalledWith({ spotify: false, soundcloud: true })
  })

  it("the host's 'block' pref is sent once, and turned off for other prefs", async () => {
    pref = 'block'
    setStatus({ role: 'host', room: room() })
    setStatus({ role: 'host', room: room({ version: 2 }) })
    expect(sent()).toEqual([{ type: 'setBlockUnplayable', on: true }])
    pref = 'skip'
    prefListeners.forEach((l) => l())
    setStatus({ role: 'host', room: room({ blockUnplayable: true, version: 3 }) })
    expect(sent()).toEqual([
      { type: 'setBlockUnplayable', on: true },
      { type: 'setBlockUnplayable', on: false }
    ])
  })

  it('guests never send the block setting', async () => {
    pref = 'block'
    setStatus({ room: room() })
    expect(sent()).toEqual([])
  })
})

describe('leaving', () => {
  it('restores the controller, pauses and clears the report', async () => {
    const { next, seek } = ctl.c
    setStatus({ role: 'host', room: room() })
    await flush()
    expect(ctl.c.next).not.toBe(next)
    report.notice = 'x'
    setStatus({ state: 'off', role: undefined, room: undefined })
    expect(ctl.c.next).toBe(next)
    expect(ctl.c.seek).toBe(seek)
    expect(ctl.c.getState().status).toBe('paused')
    expect(ctl.c.getState().repeat).toBe('all')
    expect(report).toEqual({ substitute: null, skipped: null, notice: null })
    await ctl.c.next()
    expect(ctl.fake.calls).toContain('next')
    expect(sent()).toEqual([])
  })

  it('unbinding mid-Jam also restores the controller', async () => {
    const { toggle } = ctl.c
    setStatus({ room: room() })
    await flush()
    unbind()
    expect(ctl.c.toggle).toBe(toggle)
    expect(statusListeners.size).toBe(0)
  })
})

describe('starting a Jam carries over what the host is playing (QoL 3)', () => {
  const t = (id: string): Track => fromJamTrack(jt(id))
  const local = (id: string): Track => ({
    id: `local:${id}`,
    provider: 'local',
    nativeId: id,
    title: id,
    artists: [],
    durationMs: 1000
  })
  const empty = (): JamRoomState => room({ queue: [], currentIndex: -1, playing: false })

  it('host: the current song and the rest of the queue go in, playing from the same spot', async () => {
    ctl.fake.setLocal({
      status: 'playing',
      current: { uid: 'x', track: t('a') },
      queue: [{ uid: 'y', track: t('b') }]
    })
    ctl.fake.position = 42_000
    setStatus({ role: 'host', room: empty() })
    await flush()
    expect(sent()).toEqual([
      { type: 'add', tracks: [toJamTrack(t('a')), toJamTrack(t('b'))] },
      { type: 'play', index: 0, positionMs: 42_000 }
    ])
  })

  it('the carried-over position is not undone by the auto start while the room catches up', async () => {
    ctl.fake.setLocal({ status: 'playing', current: { uid: 'x', track: t('a') }, queue: [] })
    ctl.fake.position = 42_000
    setStatus({ role: 'host', room: empty() })
    await flush()
    // The relay applies the add first: songs queued, nothing current yet.
    setStatus({ role: 'host', room: room({ queue: [entry(1)], currentIndex: -1, playing: false }) })
    await flush()
    tick()
    expect(sent().filter((c) => c.type === 'play')).toEqual([
      { type: 'play', index: 0, positionMs: 42_000 }
    ])
  })

  it('host was paused: the room starts paused at the same spot', async () => {
    ctl.fake.setLocal({ status: 'paused', current: { uid: 'x', track: t('a') }, queue: [] })
    ctl.fake.position = 5_000
    setStatus({ role: 'host', room: empty() })
    await flush()
    expect(sent()).toEqual([
      { type: 'add', tracks: [toJamTrack(t('a'))] },
      { type: 'play', index: 0, positionMs: 5_000 },
      { type: 'pause', positionMs: 5_000 }
    ])
  })

  it("host playing a local file: it can't be shared, so the room starts at the next song", async () => {
    ctl.fake.setLocal({
      status: 'playing',
      current: { uid: 'x', track: local('mine') },
      queue: [{ uid: 'y', track: t('b') }]
    })
    ctl.fake.position = 30_000
    setStatus({ role: 'host', room: empty() })
    await flush()
    expect(sent()).toEqual([
      { type: 'add', tracks: [toJamTrack(t('b'))] },
      { type: 'play', index: 0, positionMs: 0 }
    ])
  })

  it('a guest joining never sends their own queue', async () => {
    ctl.fake.setLocal({ status: 'playing', current: { uid: 'x', track: t('a') }, queue: [] })
    setStatus({ role: 'guest', room: room() })
    await flush()
    expect(sent().filter((c) => c.type === 'add' || c.type === 'play')).toEqual([])
  })

  it('no Start playing step: once songs are queued, the host starts the first one', async () => {
    setStatus({ role: 'host', room: room({ currentIndex: -1, playing: false }) })
    await flush()
    tick()
    expect(sent().filter((c) => c.type === 'play')).toEqual([{ type: 'play', index: 0 }])
  })

  it('after the queue ran out, a newly added song starts playing', async () => {
    setStatus({ role: 'host', room: room({ queue: [entry(1)], currentIndex: 0, positionMs: 0 }) })
    await flush()
    ctl.fake.end()
    expect(sent()).toContainEqual({ type: 'ended', entryId: 'e1' })
    // The relay stops on the last song; then someone adds another.
    setStatus({
      role: 'host',
      room: room({ queue: [entry(1), entry(2)], currentIndex: 0, playing: false, positionMs: 0 })
    })
    await flush()
    tick()
    expect(sent().filter((c) => c.type === 'next')).toEqual([{ type: 'next' }])
  })
})
