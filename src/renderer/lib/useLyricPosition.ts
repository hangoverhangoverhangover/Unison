import { useEffect, useState } from 'react'
import { activeLine, activeWord, type LyricLine } from '@shared/lyrics'
import { playback } from '@renderer/playback/controller'

/**
 * The current line (and word) of synced lyrics, from the live playback position in a
 * rAF loop. React only re-renders when the line or word changes.
 */
export function useLyricPosition(lines: LyricLine[] | null): { line: number; word: number } {
  const [pos, setPos] = useState({ line: -1, word: -1 })
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
        setPos({ line, word })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [lines])
  return lines?.length ? pos : { line: -1, word: -1 }
}
