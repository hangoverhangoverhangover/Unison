import { describe, expect, it } from 'vitest'
import { parseRange } from './range'

describe('parseRange', () => {
  it('returns null without a header', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange(undefined, 1000)).toBeNull()
  })

  it('parses a closed range and clamps the end', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 })
  })

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejects malformed or unsatisfiable ranges', () => {
    for (const h of ['bytes=', 'bytes=-', 'items=0-1', 'bytes=a-b', 'bytes=0-1,5-6', 'bytes=-0'])
      expect(parseRange(h, 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=50-10', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})
