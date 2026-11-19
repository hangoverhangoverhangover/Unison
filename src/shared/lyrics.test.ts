import { describe, expect, it } from 'vitest'
import { activeLine, activeWord, parseLrc, toLrc, type LyricLine } from './lyrics'

describe('parseLrc', () => {
  it('reads [mm:ss.xx] lines in time order and skips tags and blank stamps', () => {
    const lines = parseLrc(
      '[ar:Someone]\n[00:17.12] I feel your breath\n[00:05.5]Intro\n[01:02.003]Last\n'
    )
    expect(lines).toEqual([
      { timeMs: 5500, text: 'Intro' },
      { timeMs: 17120, text: 'I feel your breath' },
      { timeMs: 62003, text: 'Last' }
    ])
  })

  it('keeps empty lines (instrumental gaps) and repeated stamps on one line', () => {
    const lines = parseLrc('[00:01.00][00:20.00]Chorus\n[00:10.00]\n')
    expect(lines.map((l) => [l.timeMs, l.text])).toEqual([
      [1000, 'Chorus'],
      [10000, ''],
      [20000, 'Chorus']
    ])
  })

  it('reads word timing tags <mm:ss.xx>', () => {
    const [line] = parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>there')
    expect(line).toEqual({
      timeMs: 1000,
      text: 'Hello there',
      words: [
        { timeMs: 1000, text: 'Hello ' },
        { timeMs: 1500, text: 'there' }
      ]
    })
  })

  it('returns nothing for plain text without stamps', () => {
    expect(parseLrc('just words\nmore words')).toEqual([])
  })
})

describe('toLrc', () => {
  it('writes lines and word tags back, round-tripping', () => {
    const lines: LyricLine[] = [
      {
        timeMs: 1000,
        text: 'Hello there',
        words: [
          { timeMs: 1000, text: 'Hello ' },
          { timeMs: 1500, text: 'there' }
        ]
      },
      { timeMs: 65_430, text: 'Next' }
    ]
    const text = toLrc(lines)
    expect(text).toBe('[00:01.00]<00:01.00>Hello <00:01.50>there\n[01:05.43]Next\n')
    expect(parseLrc(text)).toEqual(lines)
  })
})

describe('activeLine / activeWord', () => {
  const lines = parseLrc('[00:05.00]a\n[00:10.00]<00:10.00>b1 <00:11.00>b2\n[00:20.00]c')
  it('is the last line that started, or -1 before the first', () => {
    expect(activeLine(lines, 0)).toBe(-1)
    expect(activeLine(lines, 5000)).toBe(0)
    expect(activeLine(lines, 10_500)).toBe(1)
    expect(activeLine(lines, 99_000)).toBe(2)
  })
  it('finds the current word in a word-timed line', () => {
    expect(activeWord(lines[1]!, 10_200)).toBe(0)
    expect(activeWord(lines[1]!, 11_200)).toBe(1)
    expect(activeWord(lines[0]!, 6000)).toBe(-1)
  })
})
