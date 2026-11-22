import { describe, expect, it } from 'vitest'
import {
  artistKey,
  isArchiveUploader,
  parseScTitle,
  splitArtists,
  stripArchiveNoise
} from './scTitle'

const known = (...names: string[]): { has(n: string): boolean } => {
  const set = new Set(names.map(artistKey))
  return { has: (n) => set.has(artistKey(n)) }
}
const none = known()

describe('parseScTitle', () => {
  it('drops the artist when the title starts with it (the *67 archive)', () => {
    expect(
      parseScTitle({ title: '*67 - funnycat313_', artist: '*67', uploader: 'archive99' }, none)
    ).toMatchObject({ title: 'funnycat313_', artists: ['*67'], confidence: 'high' })
  })

  it('also drops the uploader name at the front', () => {
    expect(
      parseScTitle({ title: 'Hi-C - Sumo', artist: 'Hi-C', uploader: 'Hi-C' }, none)
    ).toMatchObject({ title: 'Sumo', artists: ['Hi-C'] })
  })

  it('never splits a bare hyphen inside a name', () => {
    expect(parseScTitle({ title: 'Hi-C', artist: 'Hi-C', uploader: 'Hi-C' }, none).confidence).toBe(
      'none'
    )
  })

  it('leaves version tags alone', () => {
    for (const title of ['Mexico 222 - Prod. Mulla', 'Sumo - Slowed', 'Tha Lng Wayyy - Snippet']) {
      const g = parseScTitle({ title, artist: 'goldcap', uploader: 'goldcap' }, known('Mexico 222'))
      expect(g.confidence, title).toBe('none')
      expect(g.title).toBe(title)
    }
  })

  it('takes a known artist from the front', () => {
    expect(
      parseScTitle(
        { title: 'Hi-C - Tha Lng Wayyy', artist: 'goldcap_sh4wty', uploader: 'goldcap_sh4wty' },
        known('hi c')
      )
    ).toMatchObject({ title: 'Tha Lng Wayyy', artists: ['Hi-C'], confidence: 'high' })
  })

  it('swaps "Song - Artist" when only the back is a known artist', () => {
    expect(
      parseScTitle({ title: 'Sumo - Hi-C', artist: 'goldcap', uploader: 'goldcap' }, known('Hi-C'))
    ).toMatchObject({ title: 'Sumo', artists: ['Hi-C'], confidence: 'high' })
  })

  it('trusts "Artist - Title" from an archive uploader at medium confidence', () => {
    expect(
      parseScTitle(
        {
          title: 'thuggpint - neglected ass kid grows up',
          artist: 'gravelines',
          uploader: 'gravelines'
        },
        none,
        true
      )
    ).toMatchObject({
      title: 'neglected ass kid grows up',
      artists: ['thuggpint'],
      confidence: 'medium'
    })
  })

  it('splits on the first dash only and handles en and em dashes', () => {
    expect(
      parseScTitle({ title: 'A — B - C', artist: 'x', uploader: 'x' }, known('A'))
    ).toMatchObject({ title: 'B - C', artists: ['A'] })
    expect(
      parseScTitle({ title: 'A – B', artist: 'x', uploader: 'x' }, known('A')).artists
    ).toEqual(['A'])
  })

  it('keeps collabs as one string', () => {
    expect(
      parseScTitle(
        { title: 'Hi C X DOMD - True Religion', artist: 'goldcap', uploader: 'goldcap' },
        none,
        true
      ).artists
    ).toEqual(['Hi C X DOMD'])
  })

  it('changes nothing without a dash', () => {
    expect(parseScTitle({ title: 'Sumo', artist: 'Hi-C', uploader: 'Hi-C' }, none)).toMatchObject({
      title: 'Sumo',
      artists: ['Hi-C'],
      confidence: 'none'
    })
  })
})

describe('helpers', () => {
  it('artistKey ignores case, spaces and punctuation', () => {
    expect(artistKey('Hi-C')).toBe(artistKey('hi c'))
    expect(artistKey('*67')).toBe('67')
  })

  it('splits collabs for display', () => {
    expect(splitArtists('Hi C X DOMD')).toEqual(['Hi C', 'DOMD'])
    expect(splitArtists('A & B, C')).toEqual(['A', 'B', 'C'])
    expect(splitArtists('Xavier')).toEqual(['Xavier'])
  })

  it('strips archive noise for scrobbles', () => {
    expect(stripArchiveNoise('Sumo (unreleased) [CDQ] *snippet*')).toBe('Sumo')
    expect(stripArchiveNoise('Sumo [Leak]')).toBe('Sumo')
    expect(stripArchiveNoise('tfw ur cucked :/ (unmixed)')).toBe('tfw ur cucked :/ (unmixed)')
  })

  it('spots archive uploaders', () => {
    expect(
      isArchiveUploader('gravelines', [
        'thuggpint - one',
        'helen - two',
        'thuggpint - three',
        'wifiskeleton - four'
      ])
    ).toBe(true)
    expect(isArchiveUploader('Hi-C', ['Sumo', 'Hi-C - Tha Lng', 'Cobraz'])).toBe(false)
    expect(isArchiveUploader('x', ['a - b', 'c - d'])).toBe(false)
  })
})
