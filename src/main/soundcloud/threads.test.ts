import { describe, expect, it } from 'vitest'
import type { TrackComment } from '@shared/provider'
import { parseTags, plainText, threadComments } from './mapping'

const c = (id: string, ts: number, createdAt = id): TrackComment => ({
  id,
  body: id,
  timestampMs: ts,
  createdAt,
  author: { id: 'u', username: 'u' }
})

describe('threadComments', () => {
  it('puts comments missing from the top-level list under the comment before them', () => {
    const out = threadComments(
      [c('a', 0), c('a2', 900, 'b'), c('a1', 0, 'a'), c('b', 0), c('c', 900), c('c1', 5)],
      new Set(['a', 'b', 'c'])
    )
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(out[0]!.replies!.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(out[1]!.replies).toBeUndefined()
    expect(out[2]!.replies!.map((r) => r.id)).toEqual(['c1'])
  })
  it('keeps untimed (0:00) top-level comments separate', () => {
    const out = threadComments([c('a', 0), c('b', 0), c('d', 0)], new Set(['a', 'b', 'd']))
    expect(out.every((t) => !t.replies)).toBe(true)
  })
})

describe('parseTags', () => {
  it('splits quoted multi-word tags', () => {
    expect(parseTags('"hip hop" lofi  "late night" chill')).toEqual([
      'hip hop',
      'lofi',
      'late night',
      'chill'
    ])
    expect(parseTags(null)).toEqual([])
  })
})

describe('plainText', () => {
  it('strips HTML from old descriptions and decodes entities', () => {
    expect(
      plainText(
        'From the album,&nbsp;featured in <a href="https://x.com/ad">https://x.com/ad</a><br>Mixed by <b>A &amp; B</b> &#9733;'
      )
    ).toBe('From the album, featured in https://x.com/ad\nMixed by A & B ★')
    expect(plainText('<a href="https://y.com">site</a>')).toBe('site (https://y.com)')
    expect(plainText('line one\nline two')).toBe('line one\nline two')
  })
})
