import { describe, expect, it } from 'vitest'
import type { Artist, Track } from '@shared/types'
import { interleave, pickTopResult, searchLocal } from './searchMerge'

const artist = (name: string, extra: Partial<Artist> = {}): Artist => ({
  id: `soundcloud:${name}`,
  provider: 'soundcloud',
  nativeId: name,
  name,
  ...extra
})

const track = (title: string, artists = ['Someone'], album?: string): Track =>
  ({
    id: `local:${title}`,
    provider: 'local',
    nativeId: title,
    title,
    artists,
    album,
    durationMs: 1000
  }) as Track

describe('interleave', () => {
  it('alternates between lists, keeping each list in order', () => {
    expect(interleave<number | string>([[1, 2, 3], ['a']])).toEqual([1, 'a', 2, 3])
  })

  it('handles empty lists', () => {
    expect(interleave([[], [1]])).toEqual([1])
    expect(interleave([])).toEqual([])
  })
})

describe('pickTopResult', () => {
  it('prefers an artist whose name matches the query exactly, verified first', () => {
    const exact = artist('Hi-C', { verified: true })
    const top = pickTopResult(
      'hi-c',
      [artist('hi-c archive'), artist('HI-C'), exact],
      [track('Shinigami')]
    )
    expect(top).toEqual({ kind: 'artist', artist: exact })
  })

  it('falls back to the first track', () => {
    const t = track('Shinigami')
    expect(pickTopResult('hi-c', [artist('hi-c archive')], [t])).toEqual({
      kind: 'track',
      track: t
    })
  })

  it('then the first artist', () => {
    const a = artist('hi-c archive')
    expect(pickTopResult('hi-c', [a], [])).toEqual({ kind: 'artist', artist: a })
  })

  it('is null with nothing found', () => {
    expect(pickTopResult('x', [], [])).toBeNull()
  })
})

describe('searchLocal', () => {
  const lib = [
    track('Glasshouse', ['Neon Harbor'], 'Afterglow'),
    track('Low Tide', ['Neon Harbor'], 'Afterglow'),
    track('White Room', ['Paper Moons'])
  ]

  it('matches title, artist or album and respects the limit', () => {
    expect(searchLocal(lib, 'neon', 10).map((t) => t.title)).toEqual(['Glasshouse', 'Low Tide'])
    expect(searchLocal(lib, 'neon', 1)).toHaveLength(1)
  })

  it('returns nothing for a blank query', () => {
    expect(searchLocal(lib, '   ', 10)).toEqual([])
  })
})
