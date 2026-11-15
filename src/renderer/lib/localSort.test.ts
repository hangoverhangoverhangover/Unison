import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { sortLocal } from './localSort'

const t = (
  title: string,
  artist: string | undefined,
  album: string | undefined,
  path: string
): Track => ({
  id: `local:${title}`,
  provider: 'local',
  nativeId: title,
  title,
  artists: artist ? [artist] : [],
  durationMs: 1,
  localPath: path,
  ...(album ? { album } : {})
})

const list = [
  t('b', 'Zed', 'Alpha', 'C:/m/2.mp3'),
  t('a', undefined, undefined, 'C:/m/10.mp3'),
  t('c', 'adam', 'beta', 'C:/m/1.mp3')
]

describe('sortLocal', () => {
  it('unsorted keeps folder/file order with natural numbers', () => {
    expect(sortLocal(list, 'unsorted').map((x) => x.title)).toEqual(['c', 'b', 'a'])
  })
  it('artist and album put untagged files last, case-insensitive', () => {
    expect(sortLocal(list, 'artist').map((x) => x.title)).toEqual(['c', 'b', 'a'])
    expect(sortLocal(list, 'album').map((x) => x.title)).toEqual(['b', 'c', 'a'])
  })
})
