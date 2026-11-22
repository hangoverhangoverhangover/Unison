import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { KNOWN_REFRESH_MS, createTitles } from './service'

function memory(): {
  get(k: string): string | undefined
  set(k: string, v: string): void
  delete(k: string): void
} {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) }
}

const sc = (id: string, title: string, artist: string, uploader = artist): Track => ({
  id: `soundcloud:${id}`,
  provider: 'soundcloud',
  nativeId: id,
  title,
  artists: [artist],
  artistRefs: [{ id: `soundcloud:u-${uploader}`, name: artist }],
  uploader,
  durationMs: 1000
})

function setup(
  known: string[] = [],
  enabled = true
): { titles: ReturnType<typeof createTitles>; tick(ms: number): number; loads(): number } {
  let t = 0
  let loads = 0
  const titles = createTitles({
    settings: memory(),
    enabled: () => enabled,
    loadKnown: () => {
      loads++
      return known
    },
    now: () => t
  })
  return { titles, tick: (ms: number) => (t += ms), loads: () => loads }
}

describe('title cleanup', () => {
  it('tidies a title that repeats the artist and keeps the original', () => {
    const { titles } = setup()
    const out = titles.clean(sc('1', '*67 - funnycat313_', '*67', 'archive'))
    expect(out).toMatchObject({
      title: 'funnycat313_',
      artists: ['*67'],
      originalTitle: '*67 - funnycat313_',
      titleGuess: 'high'
    })
    // Same artist name: the link to the uploader stays.
    expect(out.artistRefs).toHaveLength(1)
  })

  it('uses known artists, including each name in a collab', () => {
    const { titles } = setup(['Hi C X DOMD'])
    const out = titles.clean(sc('2', 'DOMD - Mount', 'goldcap', 'goldcap'))
    expect(out).toMatchObject({ title: 'Mount', artists: ['DOMD'], originalArtist: 'goldcap' })
    expect(out.artistRefs).toBeUndefined()
  })

  it('learns archive uploaders from the titles it sees', () => {
    const { titles } = setup()
    titles.clean(sc('a', 'helen - one', 'gravelines'))
    titles.clean(sc('b', 'wifiskeleton - two', 'gravelines'))
    const out = titles.clean(sc('c', 'thuggpint - neglected', 'gravelines'))
    expect(out).toMatchObject({ artists: ['thuggpint'], title: 'neglected', titleGuess: 'medium' })
  })

  it('your fix wins, and "original" turns the tidy off for that song', () => {
    const { titles } = setup(['Hi-C'])
    titles.setOverride('soundcloud:3', { title: 'Sumo', artists: ['Hi-C', 'DOMD'] })
    expect(titles.clean(sc('3', 'whatever', 'goldcap'))).toMatchObject({
      title: 'Sumo',
      artists: ['Hi-C', 'DOMD'],
      titleGuess: 'user'
    })
    titles.setOverride('soundcloud:4', 'original')
    expect(titles.clean(sc('4', 'Hi-C - Sumo', 'goldcap')).title).toBe('Hi-C - Sumo')
    titles.setOverride('soundcloud:4', null)
    expect(titles.clean(sc('4', 'Hi-C - Sumo', 'goldcap')).title).toBe('Sumo')
  })

  it('does nothing when switched off (fixes still apply) or for other services', () => {
    const { titles } = setup(['Hi-C'], false)
    expect(titles.clean(sc('5', 'Hi-C - Sumo', 'goldcap')).title).toBe('Hi-C - Sumo')
    titles.setOverride('soundcloud:5', { title: 'Sumo', artists: ['Hi-C'] })
    expect(titles.clean(sc('5', 'Hi-C - Sumo', 'goldcap')).title).toBe('Sumo')
    const local = { ...sc('6', 'Hi-C - Sumo', 'x'), provider: 'local' as const, id: 'local:6' }
    expect(setup(['Hi-C']).titles.clean(local).title).toBe('Hi-C - Sumo')
  })

  it('reads known artists at most every few minutes', () => {
    const s = setup(['Hi-C'])
    s.titles.clean(sc('7', 'Hi-C - a', 'g'))
    s.titles.clean(sc('8', 'Hi-C - b', 'g'))
    expect(s.loads()).toBe(1)
    s.tick(KNOWN_REFRESH_MS)
    s.titles.clean(sc('9', 'Hi-C - c', 'g'))
    expect(s.loads()).toBe(2)
  })
})
