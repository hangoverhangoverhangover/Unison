import { useEffect, useState } from 'react'
import { activeLine, activeWord, type LyricLine } from '@shared/lyrics'
import { playback } from '@renderer/playback/controller'

const NONE = { line: -1, word: -1 }

/**
 * The current line (and word) of synced lyrics, from the live playback position in a
 * rAF loop. React only re-renders when the line or word changes.
 */
export function useLyricPosition(lines: LyricLine[] | null): { line: number; word: number } {
  // The position is kept with the lyrics it was worked out for: after the lyrics
  // change (new song, re-synced, the bar switched back on), an old line number could
  // point past the end of the new ones until the next frame.
  const [pos, setPos] = useState({ for: null as LyricLine[] | null, line: -1, word: -1 })
  useEffect(() => {
    if (!lines?.length) return
    let raf = 0
    let last = ''
    const frame = (): void => {
      const ms = playback.getPositionMs()
      const line = activeLine(lines, ms)
      const word = line >= 0 ? activeWord(lines[line]!, ms) : -1
      const key = `${line}:${word}`
      if (key !== last) {
        last = key
        setPos({ for: lines, line, word })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [lines])
  if (!lines?.length || pos.for !== lines || pos.line >= lines.length) return NONE
  return { line: pos.line, word: pos.word }
}
