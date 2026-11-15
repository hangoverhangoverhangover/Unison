import { describe, expect, it } from 'vitest'
import type { PlayReport } from '@shared/history'
import type { PlaybackState, PlaybackStatus } from '@shared/playback'
import { bindHistory, threshold } from './historyBridge'

interface Harness {
  set: (status: PlaybackStatus, uid?: string) => void
  advance: (ms: number) => number
  reports: PlayReport[]
  unbind: () => void
  poke: () => void
}

function harness(durationMs = 200_000): Harness {
  let t = 1000
  let listener: ((s: PlaybackState) => void) | null = null
  const reports: PlayReport[] = []
  const track = {
    id: 'local:a',
    provider: 'local' as const,
    nativeId: 'a',
    title: 'A',
    artists: [],
    durationMs
  }
  let s: PlaybackState = {
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
  const set = (status: PlaybackStatus, uid = 'u1'): void => {
    s = { ...s, status, current: { uid, track }, durationMs }
    listener?.(s)
  }
  const unbind = bindHistory(
    { getState: () => s, subscribe: (l) => ((listener = l), () => (listener = null)) },
    (r) => reports.push(r),
    () => t,
    1_000_000
  )
  return { set, advance: (ms: number) => (t += ms), reports, unbind, poke: () => listener?.(s) }
}

describe('history bridge', () => {
  it('counts once after 30 s of playing, pauses excluded', () => {
    const h = harness()
    h.set('playing')
    h.advance(20_000)
    h.set('paused')
    h.advance(60_000)
    h.set('playing')
    h.advance(9_000)
    h.poke()
    expect(h.reports).toHaveLength(0)
    h.advance(2_000)
    h.poke()
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]!.playedMs).toBe(31_000)
    h.advance(60_000)
    h.poke()
    expect(h.reports).toHaveLength(1)
    h.unbind()
  })
  it('uses half the track for short tracks, and a new entry counts again', () => {
    expect(threshold(20_000)).toBe(10_000)
    const h = harness(20_000)
    h.set('playing')
    h.advance(10_000)
    h.poke()
    h.set('playing', 'u2')
    h.advance(10_000)
    h.poke()
    expect(h.reports).toHaveLength(2)
    h.unbind()
  })
})
