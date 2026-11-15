import { describe, expect, it } from 'vitest'
import type { PlaybackState, QueueItem } from '@shared/playback'
import { toSnapshot } from './session'

const t = (id: string): QueueItem => ({
  uid: `u${id}`,
  track: {
    id: `local:${id}`,
    provider: 'local' as const,
    nativeId: id,
    title: id,
    artists: [],
    durationMs: 1000
  }
})

describe('session snapshot', () => {
  it('keeps current, queue, settings and a rounded position', () => {
    const s: PlaybackState = {
      status: 'playing',
      current: t('a'),
      queue: [t('b'), t('c')],
      positionMs: 0,
      durationMs: 1000,
      volume: 0.4,
      muted: true,
      shuffle: true,
      repeat: 'one'
    }
    const snap = toSnapshot(s, 1234.7, new Date('2026-11-12T00:00:00Z'))
    expect(snap).toEqual({
      current: t('a'),
      queue: [t('b'), t('c')],
      positionMs: 1235,
      volume: 0.4,
      muted: true,
      shuffle: true,
      repeat: 'one',
      savedAt: '2026-11-12T00:00:00.000Z'
    })
    expect(toSnapshot(s, -5, new Date(0)).positionMs).toBe(0)
  })
})
