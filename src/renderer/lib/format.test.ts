import { describe, expect, it } from 'vitest'
import { compactNumber, formatCollection, formatTime } from './format'

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(187_400)).toBe('3:07')
    expect(formatTime(3_765_000)).toBe('1:02:45')
  })
  it('clamps junk to 0:00', () => {
    expect(formatTime(-5)).toBe('0:00')
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
  })
})

describe('formatCollection', () => {
  it('pluralizes and switches to hours', () => {
    expect(formatCollection(1, 180_000)).toBe('1 song, 3 min')
    expect(formatCollection(301, 66_840_000)).toBe('301 songs, 18 hr 34 min')
  })
})

describe('compactNumber', () => {
  it('shortens big counts', () => {
    expect(compactNumber(973567)).toBe('974k')
    expect(compactNumber(2620)).toBe('2.6k')
    expect(compactNumber(413)).toBe('413')
    expect(compactNumber(1_250_000)).toBe('1.3M')
    expect(compactNumber(10_000)).toBe('10k')
  })
})
