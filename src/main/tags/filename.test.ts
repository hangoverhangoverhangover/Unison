import { describe, expect, it } from 'vitest'
import { parseFileName } from './filename'

describe('parseFileName', () => {
  it('splits on " - "', () => {
    expect(parseFileName('Artist - Title')).toEqual({ artist: 'Artist', title: 'Title' })
  })

  it('accepts en and em dashes', () => {
    expect(parseFileName('Artist – Title')).toEqual({ artist: 'Artist', title: 'Title' })
    expect(parseFileName('Artist — Title')).toEqual({ artist: 'Artist', title: 'Title' })
  })

  it('splits on the first separator only', () => {
    expect(parseFileName('A - B - C')).toEqual({ artist: 'A', title: 'B - C' })
    // The en dash comes first here.
    expect(parseFileName('A – B - C')).toEqual({ artist: 'A', title: 'B - C' })
  })

  it('strips a trailing [numeric id] from downloads', () => {
    expect(parseFileName('Artist - Title [123456]')).toEqual({ artist: 'Artist', title: 'Title' })
  })

  it('leaves other brackets and junk alone', () => {
    expect(parseFileName('Artist - Title (Official Audio) [abc]')).toEqual({
      artist: 'Artist',
      title: 'Title (Official Audio) [abc]'
    })
    expect(parseFileName('Artist - Title [12] remix')).toEqual({
      artist: 'Artist',
      title: 'Title [12] remix'
    })
  })

  it('keeps emoji and symbols', () => {
    expect(parseFileName('wifiskeleton ★ - angel \u{1F47C} [99]')).toEqual({
      artist: 'wifiskeleton ★',
      title: 'angel \u{1F47C}'
    })
  })

  it('trims both sides', () => {
    expect(parseFileName('  Artist   -   Title  ')).toEqual({ artist: 'Artist', title: 'Title' })
  })

  it('skips names without a separator', () => {
    expect(parseFileName('JustATitle')).toEqual({ skipped: "No ' - ' in the file name" })
    expect(parseFileName('Artist-Title')).toEqual({ skipped: "No ' - ' in the file name" })
  })

  it('skips an empty side', () => {
    expect(parseFileName(' - Title')).toHaveProperty('skipped')
    expect(parseFileName('Artist -  [123]')).toHaveProperty('skipped')
    expect(parseFileName('Artist - [123]')).toHaveProperty('skipped')
  })
})
