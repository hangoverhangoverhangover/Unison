import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import {
  artistMatches,
  cleanTitle,
  comparableTitle,
  MAX_MATCHES,
  normalize,
  normalizeIsrc,
  matchConfidence,
  rankMatches,
  searchQuery,
  songShape,
  stripArtistPrefix,
  titlesMatch,
  weakerConfidence
} from './match'

const t = (id: string, title: string, artists: string[], extra: Partial<Track> = {}): Track => {
  const [provider, nativeId] = id.split(':') as [Track['provider'], string]
  return { id, provider, nativeId, title, artists, durationMs: 0, ...extra }
}

describe('title helpers', () => {
  it('normalizes accents, case, punctuation and ampersands', () => {
    expect(normalize('Beyoncé — Déjà Vu!')).toBe('beyonce deja vu')
    expect(normalize('Simon & Garfunkel')).toBe('simon and garfunkel')
  })

  it('cleans feat. and remaster suffixes', () => {
    expect(cleanTitle('Song (feat. X) [Official Video]')).toBe('Song')
    expect(cleanTitle('Here Comes the Sun - Remastered 2009')).toBe('Here Comes the Sun')
    expect(cleanTitle('Song ft. Someone')).toBe('Song')
  })

  it('strips a leading artist only when it is one of the given artists', () => {
    expect(stripArtistPrefix('Forss - Flickermood', ['Forss'])).toBe('Flickermood')
    expect(stripArtistPrefix('forss – flickermood', ['FORSS'])).toBe('flickermood')
    expect(stripArtistPrefix('Intro - Outro', ['Forss'])).toBe('Intro - Outro')
    expect(stripArtistPrefix('Flickermood', ['Forss'])).toBe('Flickermood')
    expect(comparableTitle('Forss - Flickermood (feat. Y)', ['Forss'])).toBe('flickermood')
  })

  it('matches equal titles and long-enough contained titles', () => {
    expect(titlesMatch('creep', 'creep')).toBe(true)
    expect(titlesMatch('self inflicted', 'self inflicted v2')).toBe(true)
    expect(titlesMatch('love', 'love story remix edit')).toBe(false)
    expect(titlesMatch('', 'x')).toBe(false)
  })

  it('matches credited artists, contained names and artist-in-title uploads', () => {
    expect(artistMatches('The Weeknd', ['Weeknd'])).toBe(true)
    expect(artistMatches('Beyoncé', ['BEYONCE'])).toBe(true)
    expect(artistMatches('wifiskeleton', ['uploader'], 'wifiskeleton - self inflicted')).toBe(true)
    expect(artistMatches('Radiohead', ['Someone'], 'Creep')).toBe(false)
  })

  it('handles short artist names without loose substring hits', () => {
    expect(artistMatches('M', ['M'])).toBe(true)
    expect(artistMatches('M', ['Muse'])).toBe(false)
    expect(artistMatches('M', ['x'], 'Muse - Uprising')).toBe(false)
    expect(artistMatches('', ['x'])).toBe(false)
  })

  it('validates ISRCs', () => {
    expect(normalizeIsrc('us-rc1-17-00001')).toBe('USRC11700001')
    expect(normalizeIsrc('GBAYE0601498')).toBe('GBAYE0601498')
    expect(normalizeIsrc('x artist:y')).toBeNull()
    expect(normalizeIsrc(undefined)).toBeNull()
  })

  it('builds the search query from the first artist and the cleaned title', () => {
    expect(searchQuery({ title: 'Song (feat. B)', artists: ['A', 'B'] })).toBe('A Song')
    expect(searchQuery({ title: 'Forss - Flickermood', artists: ['Forss'] })).toBe(
      'Forss Flickermood'
    )
    expect(searchQuery({ title: 'Song', artists: [] })).toBeNull()
  })
})

describe('rankMatches', () => {
  const source = t('spotify:src', 'Flickermood', ['Forss'], {
    isrc: 'SEABC0400001',
    durationMs: 200_000
  })

  it('puts ISRC matches first, then exact titles, close durations and service order', () => {
    const res = rankMatches(source, [
      t('soundcloud:1', 'Flickermood (Edit)', ['Forss'], { durationMs: 200_000 }),
      t('soundcloud:2', 'Forss - Flickermood', ['uploader'], { durationMs: 400_000 }),
      t('soundcloud:3', 'Flickermood', ['Forss'], { durationMs: 201_500 }),
      t('soundcloud:4', 'Flickermood', ['someone else']),
      t('soundcloud:5', 'Other song', ['x'], { isrc: 'seabc0400001' }),
      t('soundcloud:6', 'Another song', ['Forss'])
    ])
    expect(res.map((m) => [m.track.id, m.reason])).toEqual([
      ['soundcloud:5', 'isrc'],
      ['soundcloud:3', 'title-artist'],
      ['soundcloud:2', 'title-artist'],
      ['soundcloud:1', 'title-artist']
    ])
  })

  it('moves previews and blocked tracks to the end instead of dropping them', () => {
    const res = rankMatches(source, [
      t('soundcloud:p', 'Flickermood', ['Forss'], {
        isrc: 'SEABC0400001',
        availability: 'preview'
      }),
      t('soundcloud:b', 'Flickermood', ['Forss'], { availability: 'blocked' }),
      t('soundcloud:f', 'Flickermood (Edit)', ['Forss'])
    ])
    expect(res.map((m) => m.track.id)).toEqual(['soundcloud:f', 'soundcloud:p', 'soundcloud:b'])
  })

  it('dedupes by id, excludes the source and caps the list', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      t(`soundcloud:${i}`, 'Flickermood', ['Forss'])
    )
    const res = rankMatches(source, [t('spotify:src', 'Flickermood', ['Forss']), ...many, ...many])
    expect(res).toHaveLength(MAX_MATCHES)
    expect(new Set(res.map((m) => m.track.id)).size).toBe(MAX_MATCHES)
    expect(res.some((m) => m.track.id === 'spotify:src')).toBe(false)
  })

  it('matches nothing without an artist or ISRC', () => {
    const local = t('local:1', 'Flickermood', [])
    expect(rankMatches(local, [t('soundcloud:1', 'Flickermood', ['Forss'])])).toEqual([])
  })

  it('strips the artist prefix from a SoundCloud source too', () => {
    const sc = t('soundcloud:9', 'Forss - Flickermood', ['Forss'])
    const res = rankMatches(sc, [t('spotify:1', 'Flickermood', ['Forss'])])
    expect(res.map((m) => m.reason)).toEqual(['title-artist'])
  })
})

describe('same-song confidence (transfer + duplicates)', () => {
  it('strips multi-artist prefixes when one of them is credited', () => {
    expect(stripArtistPrefix('A & B - Song', ['B'])).toBe('Song')
    expect(stripArtistPrefix('A x B — Song', ['A'])).toBe('Song')
    expect(stripArtistPrefix('A, B - Song', ['C'])).toBe('A, B - Song')
  })

  it('reads "Artist - Title" by an uploader as Artist + Title', () => {
    const shape = songShape({ title: 'Forss - Flickermood', artists: ['archive'] })
    expect(shape.readings).toEqual([
      { artists: ['archive'], title: 'forss flickermood' },
      { artists: ['forss'], title: 'flickermood' }
    ])
  })

  it('rates isrc, exact, close and none', () => {
    const base = { title: 'Song', artists: ['Artist'], isrc: 'USAAA2400001' }
    expect(matchConfidence(base, { title: 'x', artists: ['y'], isrc: 'US-AAA-24-00001' })).toBe(
      'isrc'
    )
    expect(matchConfidence(base, { title: 'Song (feat. Z)', artists: ['ARTIST', 'Z'] })).toBe(
      'exact'
    )
    expect(matchConfidence(base, { title: 'Artist - Song', artists: ['uploader'] })).toBe('exact')
    expect(matchConfidence(base, { title: 'Songs', artists: ['The Artist'] })).toBe('close')
    expect(matchConfidence(base, { title: 'Song', artists: ['Other'] })).toBeNull()
    expect(matchConfidence(base, { title: 'Something Else', artists: ['Artist'] })).toBeNull()
  })

  it('orders confidences', () => {
    expect(weakerConfidence('isrc', 'close')).toBe('close')
    expect(weakerConfidence('exact', 'isrc')).toBe('exact')
  })
})
