import { beforeEach, describe, expect, it } from 'vitest'
import type { PlaybackState } from '@shared/playback'
import type { Track } from '@shared/types'
import { bindLastfm } from './lastfmBridge'

const track = (id: string, durationMs = 200_000): Track =>
  ({
    id: `soundcloud:${id}`,
    provider: 'soundcloud',
    nativeId: id,
    title: id,
    artists: ['A'],
    durationMs
  }) as Track

let now: number
let state: PlaybackState
let listener: (s: PlaybackState) => void
let ticks: (() => void)[]
let calls: string[]

const set = (p: Partial<PlaybackState>): void => {
  state = { ...state, ...p }
  listener(state)
}
const tick = (ms: number): void => {
  now += ms
  ticks.forEach((t) => t())
}

beforeEach(() => {
  now = 1_000_000
  ticks = []
  calls = []
  state = {
    status: 'idle',
    current: null,
    queue: [],
    positionMs: 0,
    durationMs: 0,
    volume: 1,
    muted: false,
    shuffle: false,
    repeat: 'off'
  }
  bindLastfm(
    {
      getState: () => state,
      subscribe: (l) => {
        listener = l
        return () => undefined
      }
    },
    {
      nowPlaying: (t) => void calls.push(`now ${t.nativeId}`),
      scrobble: (r) => void calls.push(`scrobble ${r.track.nativeId} @${r.startedAt}`)
    },
    () => now,
    (fn) => {
      ticks.push(fn)
      return () => undefined
    }
  )
})

describe('Last.fm bridge', () => {
  it('sends now playing once when a track starts playing', () => {
    set({ current: { uid: 'u1', track: track('a') }, status: 'loading' })
    set({ status: 'playing', durationMs: 200_000 })
    set({ status: 'paused' })
    set({ status: 'playing' })
    expect(calls).toEqual(['now a'])
  })

  it('scrobbles once after half the track (or 4 min) of real listening, with its start time', () => {
    set({ current: { uid: 'u1', track: track('a') }, status: 'playing', durationMs: 200_000 })
    tick(90_000)
    expect(calls).toEqual(['now a'])
    tick(15_000)
    tick(60_000)
    expect(calls).toEqual(['now a', 'scrobble a @1000000'])
  })

  it('paused time does not count', () => {
    set({ current: { uid: 'u1', track: track('a') }, status: 'playing', durationMs: 200_000 })
    tick(60_000)
    set({ status: 'paused' })
    tick(600_000)
    expect(calls).toEqual(['now a'])
  })

  it('never scrobbles tracks of 30 seconds or less', () => {
    set({
      current: { uid: 'u1', track: track('s', 30_000) },
      status: 'playing',
      durationMs: 30_000
    })
    tick(30_000)
    expect(calls).toEqual(['now s'])
  })

  it('a new queue entry starts over, even for the same song', () => {
    set({ current: { uid: 'u1', track: track('a') }, status: 'playing', durationMs: 200_000 })
    tick(120_000)
    set({ current: { uid: 'u2', track: track('a') }, status: 'playing' })
    tick(120_000)
    expect(calls.filter((c) => c.startsWith('scrobble'))).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith('now'))).toHaveLength(2)
  })
})
