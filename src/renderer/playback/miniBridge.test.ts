import { describe, expect, it, vi } from 'vitest'
import type { PlaybackState } from '@shared/playback'
import { runMiniCommand, toMiniState } from './miniBridge'

const state: PlaybackState = {
  status: 'playing',
  current: {
    uid: 'u',
    track: {
      id: 'spotify:1',
      provider: 'spotify',
      nativeId: '1',
      title: 'T',
      artists: ['A'],
      durationMs: 200_000
    }
  },
  queue: [],
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  muted: false,
  shuffle: true,
  repeat: 'all'
}

describe('mini bridge', () => {
  it('snapshots position, duration fallback and queue', () => {
    expect(toMiniState(state, 1234.6, 99)).toMatchObject({
      positionMs: 1235,
      at: 99,
      durationMs: 200_000,
      hasNext: false,
      shuffle: true,
      repeat: 'all'
    })
    expect(toMiniState({ ...state, current: null }, -5, 1).track).toBeNull()
  })
  it('maps commands to the controller', () => {
    const c = {
      toggle: vi.fn(async () => undefined),
      next: vi.fn(async () => undefined),
      previous: vi.fn(async () => undefined),
      seek: vi.fn(),
      subscribe: vi.fn(),
      getState: vi.fn(),
      getPositionMs: vi.fn()
    }
    runMiniCommand(c, { type: 'toggle' })
    runMiniCommand(c, { type: 'next' })
    runMiniCommand(c, { type: 'previous' })
    runMiniCommand(c, { type: 'seek', positionMs: -10 })
    runMiniCommand(c, { type: 'seek', positionMs: Number.NaN })
    expect(c.toggle).toHaveBeenCalledOnce()
    expect(c.next).toHaveBeenCalledOnce()
    expect(c.previous).toHaveBeenCalledOnce()
    expect(c.seek).toHaveBeenCalledOnce()
    expect(c.seek).toHaveBeenCalledWith(0)
  })
})
