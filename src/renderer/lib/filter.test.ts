import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { filterTracks } from './filter'

const t = (title: string, artists: string[], album?: string): Track => ({
  id: `spotify:${title}`,
  provider: 'spotify',
  nativeId: title,
  title,
  artists,
  durationMs: 1,
  ...(album ? { album } : {})
})

describe('filterTracks', () => {
  const list = [
    t('Crossroads', ['witchbox', 'wifiskeleton']),
    t('Dinner', ['witchbox'], 'SHES IN MY SKIN'),
    t('Café', ['Hi-C'])
  ]
  it('matches every word across title, artists and album, ignoring case and accents', () => {
    expect(filterTracks(list, 'WITCHBOX skin')?.tracks.map((x) => x.title)).toEqual(['Dinner'])
    expect(filterTracks(list, 'cafe')?.positions).toEqual([2])
    expect(filterTracks(list, 'hi c')?.tracks).toHaveLength(1)
  })
  it('returns null for an empty query and keeps original positions', () => {
    expect(filterTracks(list, '   ')).toBeNull()
    expect(filterTracks(list, 'witchbox')?.positions).toEqual([0, 1])
  })
})
