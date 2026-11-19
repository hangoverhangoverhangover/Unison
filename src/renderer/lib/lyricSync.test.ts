import { describe, expect, it } from 'vitest'
import { buildLines, startSync, tap, undo, wordsOf } from './lyricSync'

const text = 'First line here\n\nSecond line\nThird'

describe('lyric sync (tap along)', () => {
  it('splits pasted text into non-empty lines', () => {
    expect(startSync(text, 'lines').lines).toEqual(['First line here', 'Second line', 'Third'])
  })

  it('stamps each line in turn and builds LRC lines', () => {
    let s = startSync(text, 'lines')
    s = tap(s, 1000)
    s = tap(s, 4000)
    s = tap(s, 9000)
    expect(s.done).toBe(true)
    expect(buildLines(s)).toEqual([
      { timeMs: 1000, text: 'First line here' },
      { timeMs: 4000, text: 'Second line' },
      { timeMs: 9000, text: 'Third' }
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
    for (const t of [1000, 1500, 3000]) s = tap(s, t)
    expect(buildLines(s)).toEqual([
      {
        timeMs: 1000,
        text: 'Hello there',
        words: [
          { timeMs: 1000, text: 'Hello ' },
          { timeMs: 1500, text: 'there' }
        ]
      },
      { timeMs: 3000, text: 'Bye', words: [{ timeMs: 3000, text: 'Bye' }] }
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
