import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { tracksFor } from './addCheck'

const t = (id: string): Track => ({
  id,
  provider: 'local',
  nativeId: id,
  title: id,
  artists: ['A'],
  durationMs: 1
})

describe('tracksFor', () => {
  const tracks = [t('a'), t('b'), t('c')]
  const matches = [{ track: t('b'), match: t('b'), sameTrack: true }]
  it('adds all, only the new ones, or none', () => {
    expect(tracksFor('all', tracks, matches)).toEqual(tracks)
    expect(tracksFor('new', tracks, matches).map((x) => x.id)).toEqual(['a', 'c'])
    expect(tracksFor('cancel', tracks, matches)).toEqual([])
  })
})
