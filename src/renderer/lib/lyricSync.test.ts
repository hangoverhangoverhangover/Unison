import { describe, expect, it } from 'vitest'
import { buildLines, currentLineIndex, startSync, tap, undo, wordsOf } from './lyricSync'

const text = 'First line here\n\nSecond line\nThird'

describe('lyric sync (tap along)', () => {
  it('splits pasted text into non-empty lines', () => {
    expect(startSync(text, 'lines').lines).toEqual(['First line here', 'Second line', 'Third'])
  })

  it('first tap starts the first line; each tap after ends the line being sung', () => {
    let s = startSync(text, 'lines')
    expect(currentLineIndex(s)).toBe(0)
    s = tap(s, 1000) // First line starts
    expect(currentLineIndex(s)).toBe(0)
    s = tap(s, 4000) // First line ends, Second begins
    expect(currentLineIndex(s)).toBe(1)
    s = tap(s, 9000)
    expect(s.done).toBe(false)
    s = tap(s, 12000) // Third ends: done
    expect(s.done).toBe(true)
    expect(buildLines(s)).toEqual([
      { timeMs: 1000, text: 'First line here' },
      { timeMs: 4000, text: 'Second line' },
      { timeMs: 9000, text: 'Third' },
      // The end of the last line clears it.
      { timeMs: 12000, text: '' }
    ])
  })

  it('undo steps back one tap', () => {
    let s = tap(tap(startSync(text, 'lines'), 1000), 4000)
    s = undo(s)
    expect(s.cursor).toBe(1)
    s = tap(s, 5000)
    expect(buildLines(s)[1]!.timeMs).toBe(5000)
  })

  it('word mode stamps every word; a line starts at its first word', () => {
    let s = startSync('Hello there\nBye', 'words')
    expect(s.total).toBe(3)
    for (const t of [1000, 1500, 3000, 3600]) s = tap(s, t)
    expect(s.done).toBe(true)
    expect(buildLines(s)).toEqual([
      {
        timeMs: 1000,
        text: 'Hello there',
        words: [
          { timeMs: 1000, text: 'Hello ' },
          { timeMs: 1500, text: 'there' }
        ]
      },
      { timeMs: 3000, text: 'Bye', words: [{ timeMs: 3000, text: 'Bye' }] },
      { timeMs: 3600, text: '' }
    ])
  })

  it('a tap never goes back in time (ignores earlier positions)', () => {
    let s = tap(startSync(text, 'lines'), 5000)
    s = tap(s, 4000)
    expect(s.cursor).toBe(1)
  })

  it('wordsOf keeps the spaces with the words', () => {
    expect(wordsOf('a b  c')).toEqual(['a ', 'b  ', 'c'])
  })
})
